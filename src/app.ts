import ws, {IUtf8Message} from "websocket"
import {createClient} from 'redis'
import http from "http"
import dotenv from "dotenv"
import {v4 as uuidv4} from 'uuid'
import {getIndexOnOccurrence} from "./utils/Strings"

type UserType = "host" | "guess"
type MessagePrefix = "con" | "dis" | "mes" | "ack"

type Number = `${number}`
type NumberWithGuessId = `${Number}:${string}`
type NumberWithBody = `${Number}:${string}`
type NumberWithGuessIdWithBody = `${NumberWithGuessId}:${string}`
type OutboundToHostMesMessage = `mes:${NumberWithGuessIdWithBody}`
type OutboundToHostConMessage = `con:${NumberWithGuessId}`
type OutboundToHostDisMessage = `dis:${NumberWithGuessId}`
type OutboundToHostAckMessage = `ack:${Number}`
type OutboundToGuessMesMessage = `mes:${NumberWithBody}`
type OutboundToGuessConMessage = `con:${Number}`
type OutboundToGuessDisMessage = `dis:${Number}`
type OutboundToGuessAckMessage = `ack:${Number}`
type OutboundMesMessage<UT extends UserType> = UT extends "host" ? OutboundToHostMesMessage : OutboundToGuessMesMessage
type OutboundAckMessage<UT extends UserType> = UT extends "host" ? OutboundToHostAckMessage : OutboundToGuessAckMessage
type OutboundConMessage<UT extends UserType> = UT extends "host" ? OutboundToHostConMessage : OutboundToGuessConMessage
type OutboundDisMessage<UT extends UserType> = UT extends "host" ? OutboundToHostDisMessage : OutboundToGuessDisMessage
type OutboundMessage<UT extends UserType> = OutboundMesMessage<UT> | OutboundConMessage<UT> | OutboundDisMessage<UT> | OutboundAckMessage<UT>
type InboundFromHostMesMessage = `mes:${NumberWithGuessIdWithBody}`
type InboundFromHostAckMessage = `ack:${NumberWithGuessId}`
type InboundFromGuessMesMessage = `mes:${NumberWithBody}`
type InboundFromGuessAckMessage = `ack:${Number}`
type InboundMesMessage<UT extends UserType> = UT extends "host" ? InboundFromHostMesMessage : InboundFromGuessMesMessage
type InboundAckMessage<UT extends UserType> = UT extends "host" ? InboundFromHostAckMessage : InboundFromGuessAckMessage
type InboundMessage<UT extends UserType> = InboundMesMessage<UT> | InboundAckMessage<UT>
type HandleMesMessage<UT extends UserType> = (m: InboundMesMessage<UT>) => void
type HandleAckMessage<UT extends UserType> = (a: InboundAckMessage<UT> ) => void

type Message<UT extends UserType> = InboundMessage<UT> | OutboundMessage<UT>
type MessageKey<UT extends UserType> = `${UT}:${string}`
type GetConMessageAndKey<UT extends UserType> = () => [OutboundConMessage<UT>, MessageKey<UT>]
type GetDisMessageAndKey<UT extends UserType> = () => [OutboundDisMessage<UT>, MessageKey<UT>]
type GetMesMessageAndKey<UT extends UserType> = () => [OutboundMesMessage<UT>, MessageKey<UT>]
type GetAckMessageAndKey<UT extends UserType> = () => [OutboundAckMessage<UT>, MessageKey<UT>]
type SendMessage = (mp: MessagePrefix, payload: string) => void
type SubscribeToMessages = (sendMessage: SendMessage, isHostUser: boolean, guessId?: string) => void
type PublishMessage = <B extends boolean>(mp: MessagePrefix, payload: string, toHostUser: B, toGuessId: B extends false ? string : undefined) => void
type CacheMessage = <UT extends UserType>(key: MessageKey<UT>, message: OutboundMessage<UT>) => void
type RemoveAckMess age = <UT extends UserType>(key: MessageKey<UT>, message: OutboundMessage<UT>) => void
type IsMessageAck = <UT extends UserType>(key: MessageKey<UT>) => Promise<boolean>

type MessagePart = "prefix" | "number" | "guessId" | "body"
type SpecificMessagePart<M extends Message<UserType>> = Exclude<MessagePart, M extends `${MessagePrefix}:${NumberWithGuessIdWithBody}` ? "" :
    M extends `mes:${NumberWithBody}` ? "guessId" :
        M extends `${MessagePrefix}:${NumberWithGuessId}` ? "body" :
            M extends `${MessagePrefix}:${Number}` ? "body" | "guessId" : never>
type WhatMessagePartsGet<M extends Message<UserType>> = { [K in SpecificMessagePart<M>]?: true }
type HasFourParts<M extends Message<UserType>> = M extends `${MessagePrefix}:${NumberWithGuessIdWithBody}` ? true : false
type GotMessageParts<M extends Message<UserType>> = { [K in keyof WhatMessagePartsGet<M>]-? : string }

const getMessageParts = <M extends Message<UserType>>(m: M, whatGet: WhatMessagePartsGet<M>, hasFourParts: HasFourParts<M>) => {
    const messageParts: any = {}
    const getPartSeparatorIndex = (occurrence: number) => getIndexOnOccurrence(m, ":", occurrence)
    switch (true) {
        case "prefix" in whatGet:
            messageParts["prefix"] = m.substring(0, 3)
        case "number" in whatGet:
            messageParts["number"] = m.substring(4, getPartSeparatorIndex(2))
        case "guessId" in whatGet:
            messageParts["guessId"] = m.substring(getPartSeparatorIndex(2) + 1, getPartSeparatorIndex(3))
        case "body" in whatGet:
            messageParts["body"] = m.substring(getPartSeparatorIndex(hasFourParts ? 3 : 2) + 1, m.length - 1)
    }
    return messageParts as GotMessageParts<M>
}
const getCutMessage = <M extends Message<UserType>>(m: M, whatCut: WhatMessagePartsGet<M>, hasFourParts: HasFourParts<M>) => {
    let cutMessage = ""
    const getPartSeparatorIndex = (occurrence: number) => getIndexOnOccurrence(m, ":", occurrence)
    switch (true) {
        case !("prefix" in whatCut):
            cutMessage += m.substring(0, 3)
        case !("number" in whatCut):
            cutMessage += m.substring(4, getPartSeparatorIndex(2))
        case !("guessId" in whatCut):
            cutMessage += m.substring(getPartSeparatorIndex(2) + 1, getPartSeparatorIndex(3))
        case !("body" in whatCut):
            cutMessage += m.substring(getPartSeparatorIndex(hasFourParts ? 3 : 2) + 1, m.length - 1)
    }
    return cutMessage
}

dotenv.config()

const initRedisConnection = async () => {
    const client = createClient({username: process.env.REDIS_USERNAME, password: process.env.REDIS_PASSWORD})
    try {
        await client.connect()
    } catch (e) {
        console.log(`could not connect with redis:${e}`)
    }
    return client
}
const initHttpServer = () => {
    const httpServer = http.createServer((request, response) => {
        console.log((new Date()) + ' Received request for ' + request.url)
        response.writeHead(404)
        response.end()
    })
    httpServer.listen(process.env.PORT, () => {
        console.log((new Date()) + 'http server is listening')
    })

    return httpServer
}
const initWebSocket = (subscribeToMessages : SubscribeToMessages, publishMessage: PublishMessage, cacheMessage: CacheMessage, isMessageAck: IsMessageAck) => {
    const wsServer = new ws.server({
        httpServer: initHttpServer(),
        autoAcceptConnections: false
    })

    const originIsAllowed = (origin: string) => {
        return true
    }
    wsServer.on("request", (request) => {
        const origin = request.origin
        const date = Date.now()
        if (!originIsAllowed(origin)) {
            request.reject()
            console.log(`${date} connection from origin ${origin} rejected.`)
        } else {
            const connection = request.accept("echo-protocol", origin)
            console.log((date) + " connection accepted")

            const userType: UserType  = request.httpRequest.headers.host_user === process.env.HOST_USER_SECRET ? "host" : "guess"
            const isHostUser = userType === "host"

            const guessId = userType === "host" ? undefined : uuidv4()

            const sendMessageHost: SendMessage = (mp, payload) => {
                const getConMessageAndKey: GetConMessageAndKey<"host"> = () => {
                    const message: OutboundToHostConMessage = `con:${payload as NumberWithGuessId}`
                    const key: MessageKey<"host"> = `host:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey<"host"> = () => {
                    const message: OutboundToHostDisMessage = `dis:${payload as NumberWithGuessId}`
                    const key: MessageKey<"host"> = `host:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey<"host"> = () => {
                    const message: OutboundToHostMesMessage = `mes:${payload as NumberWithGuessIdWithBody}`
                    const key: MessageKey<"host"> = `host:${getCutMessage(message, {body: true}, true)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey<"host"> = () => {
                    const message: OutboundToHostAckMessage = `ack:${payload as Number}`
                    const key: MessageKey<"host"> = `host:${message}`
                    return [message, key]
                }
                sendMessage(mp, getConMessageAndKey, getDisMessageAndKey, getMesMessageAndKey, getAckMessageAndKey)

            }
            const sendMessageGuess: SendMessage = (mp, payload) => {
                const getConMessageAndKey: GetConMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessConMessage = `con:${payload as Number}`
                    const key: MessageKey<"guess"> = `guess:${guessId}:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessDisMessage = `dis:${payload as Number}`
                    const key: MessageKey<"guess"> = `guess:${guessId}:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessMesMessage = `mes:${payload as NumberWithBody}`
                    const key: MessageKey<"guess"> = `guess:${guessId}:${getCutMessage(message, {body: true}, false)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessAckMessage = `ack:${payload as Number}`
                    const key: MessageKey<"guess"> = `guess:${guessId}:${message}`
                    return [message, key]
                }
                sendMessage(mp, getConMessageAndKey, getDisMessageAndKey, getMesMessageAndKey, getAckMessageAndKey)
            }

            const sendMessage = <UT extends UserType>(mp: MessagePrefix, getConMessageAndKey: GetConMessageAndKey<UT>, getDisMessageAndKey: GetDisMessageAndKey<UT>, getMesMessageAndKey: GetMesMessageAndKey<UT>,getAckMessageAndKey: GetAckMessageAndKey<UT>) => {
                let message : OutboundMessage<UT>
                let key: MessageKey<UT>
                switch (mp) {
                    case "con":
                        [message, key] = getConMessageAndKey()
                        break
                    case "dis":
                        [message, key] = getDisMessageAndKey()
                        break
                    case "mes":
                        [message, key] = getMesMessageAndKey()
                        break
                    case "ack":
                        [message, key] = getAckMessageAndKey()
                        break
                    default:
                        throw new Error("should had enter some case")
                }
                cacheMessage<UT>(key, message)
                const resendUntilAck = () => {
                    connection.sendUTF(message)
                    setTimeout(() => {
                        isMessageAck(key).then(is => {
                            if (!is) {
                                resendUntilAck()
                            }
                        })

                    }, 5000)
                }
                resendUntilAck()
            }

            subscribeToMessages(isHostUser ? sendMessageHost : sendMessageGuess, isHostUser, guessId)
            publishMessage("con", date + ":" + (isHostUser ? "" : guessId), !isHostUser, guessId)

            const handleMessage = <UT extends UserType>(m: ws.Message, handleMesMessage: HandleMesMessage<UT>, handleAckMessage: HandleAckMessage<UT>) => {
                const utf8Data = (m as IUtf8Message).utf8Data as InboundMessage<UT>
                const prefix = utf8Data.substring(0, utf8Data.indexOf(":")) as "mes" | "ack"
                switch (prefix) {
                    case "mes":
                        handleMesMessage(utf8Data as InboundMesMessage<UT>)
                        break
                    case "ack":
                        handleAckMessage(utf8Data as InboundAckMessage<UT>)
                        break
                }
                console.log((new Date()) + " message: " + m)
            }
            const handleMessageFromHost = (m: ws.Message) => {
                const handleMesMessage: HandleMesMessage<"host"> = (m) => {
                    const {number, guessId: toGuessId, body} = getMessageParts(m, {number: true, guessId: true, body: true}, true)
                    publishMessage("mes", number + ":" + body, false, toGuessId)
                }
                const handleAckMessage: HandleAckMessage<"host"> = (a) => {
                    const {number, guessId: toGuessId} = getMessageParts(a, {number: true, guessId: true}, false)
                    publishMessage("ack", number, false, toGuessId)
                }
                handleMessage(m, handleMesMessage, handleAckMessage)
            }
            const handleMessageFromGuess = (m: ws.Message) => {
                const handleMesMessage: HandleMesMessage<"guess"> = (m) => {
                    const {number, body} = getMessageParts(m, {number: true, body: true}, false)
                    publishMessage("mes", number + ":" + guessId + ":" + body, true, undefined)
                }
                const handleAckMessage: HandleAckMessage<"guess"> = (a) => {
                    const {number} = getMessageParts(a, {number: true}, false)
                    publishMessage("ack", number, true, undefined)
                }
                handleMessage(m, handleMesMessage, handleAckMessage)
            }
            connection.on("message", isHostUser ? handleMessageFromHost : handleMessageFromGuess)
            connection.on("close", (reasonCode, description) => {
                const disDate = Date.now()
                publishMessage("dis", disDate + ":" + (isHostUser ? "" : guessId), !isHostUser, guessId)
                console.log(disDate + " peer " + connection.remoteAddress + " disconnected.")
            })
        }
    })
}

const init = async () => {
    const redisClient = await initRedisConnection()

    const suffixHost = "host"
    const suffixGuess = "guess"
    const getConnectionsChannel = (isHostUser: boolean) =>  "con" + "-" + (isHostUser ? suffixHost : suffixGuess)
    const getDisconnectionsChannel = (isHostUser: boolean) =>  "dis" + "-" + (isHostUser ? suffixHost : suffixGuess)
    const getMessagesChannel = (isHostUser: boolean, guessId?: string) => "mes" + "-" + (isHostUser ? suffixHost : suffixGuess + "-" + guessId)
    const getAcknowledgmentChannel = (isHostUser: boolean, guessId?: string) => "ack" + "-" + (isHostUser ? suffixHost : suffixGuess + "-" + guessId)

    const subscribeToMessages: SubscribeToMessages = async (sendMessage, isHostUser, guessId) => {
        const subscriber = redisClient.duplicate()
        await subscriber.connect()

        await subscriber.subscribe(getConnectionsChannel(isHostUser), (message, channel) => {
            sendMessage("con", message)
        })
        await subscriber.subscribe(getDisconnectionsChannel(isHostUser), (message, channel) => {
            sendMessage("dis", message)
        })
        await subscriber.subscribe(getMessagesChannel(isHostUser, guessId), (message, channel) => {
            sendMessage("mes", message)
        })
        await subscriber.subscribe(getAcknowledgmentChannel(isHostUser, guessId), (message, channel) => {
            sendMessage("ack", message)
        })
    }
    const publishMessage: PublishMessage = (mp, payload, toHostUser, toGuessId) => {
        let channel
        switch (mp) {
            case "con":
                channel = getConnectionsChannel(toHostUser)
                break
            case "dis":
                channel = getDisconnectionsChannel(toHostUser)
                break
            case "mes":
                channel = getMessagesChannel(toHostUser, toGuessId)
                break
            case "ack":
                channel = getAcknowledgmentChannel(toHostUser, toGuessId)
                break
        }
        redisClient.publish(channel, payload)
    }

    const cacheMessage: CacheMessage = (key, message) => { redisClient.set(key, message) }
    const isMessageAck: IsMessageAck = async (key) => await redisClient.get(key) === null

    initWebSocket(subscribeToMessages, publishMessage, cacheMessage, isMessageAck)
}

