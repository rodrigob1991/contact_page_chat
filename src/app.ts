import ws, {IUtf8Message} from "websocket"
import {createClient} from 'redis'
import http from "http"
import dotenv from "dotenv"
import {v4 as uuidv4} from 'uuid'
import {getIndexOnOccurrence} from "./utils/Strings"

type UserType = "host" | "guess"

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
type OutboundMessage = OutboundToHostMesMessage | OutboundToHostConMessage | OutboundToHostDisMessage | OutboundToHostAckMessage
    | OutboundToGuessMesMessage | OutboundToGuessConMessage | OutboundToGuessDisMessage | OutboundToGuessAckMessage

type InboundFromHostMesMessage = `mes:${NumberWithGuessIdWithBody}`
type InboundFromHostAckMessage = `ack:${NumberWithGuessId}`
type InboundFromGuessMesMessage = `mes:${NumberWithBody}`
type InboundFromGuessAckMessage = `ack:${Number}`
type InboundMessage = InboundFromHostMesMessage | InboundFromHostAckMessage | InboundFromGuessMesMessage | InboundFromGuessAckMessage

type Message = InboundMessage | OutboundMessage

type MessagePrefix = "con" | "dis" | "mes" | "ack"
type SendMessage = (mp: MessagePrefix, payload: string) => void
type SubscribeToMessages = (sendMessage: SendMessage, isHostUser: boolean, guessId?: string) => void
type PublishMessage = (mp: MessagePrefix, payload: string, toHostUser: boolean, guessId?: string) => void
type CacheMessage = (key: string, message: OutboundMessage) => void
type IsMessageAck = (key: string) => Promise<boolean>

type MessagePart = "prefix" | "number" | "guessId" | "body"
type SpecificMessagePart<M extends Message> = Exclude<MessagePart, M extends `${MessagePrefix}:${NumberWithGuessIdWithBody}` ? "" :
    M extends `mes:${NumberWithBody}` ? "guessId" :
        M extends `${MessagePrefix}:${NumberWithGuessId}` ? "body" :
            M extends `${MessagePrefix}:${Number}` ? "body" | "guessId" : never>
type WhatMessagePartsGet<M extends Message> = { [K in SpecificMessagePart<M>]?: true }
type HasFourParts<M extends Message> = M extends `${MessagePrefix}:${NumberWithGuessIdWithBody}` ? true : false
type GotMessageParts<WMPE extends WhatMessagePartsGet<Message>> = { [K in keyof WMPE] : string }

const getMessageParts = <M extends Message, WMPE extends WhatMessagePartsGet<M>>(m: M, whatGet: WMPE, hasFourParts: HasFourParts<M>) => {
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
    return messageParts as GotMessageParts<WMPE>
}
const getCutMessage = <M extends Message>(m: M, whatCut: WhatMessagePartsGet<M>, hasFourParts: HasFourParts<M>) => {
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

            const sendMessage: SendMessage = (mp, payload) => {
                let messageKey = userType + ":"
                let message: OutboundMessage
                const isConnection = mp === "con"
                const isDisconnection = mp === "dis"
                const isMessage = mp === "mes"
                const isAcknowledge = mp === "ack"
                switch (true) {
                    case isConnection && isHostUser:
                        message = `con:${payload as NumberWithGuessId}`
                        messageKey += message
                        break
                    case isConnection && !isHostUser:
                        message = `con:${payload as Number}`
                        messageKey += guessId + ":" + message
                        break
                    case isDisconnection && isHostUser:
                        message = `dis:${payload as NumberWithGuessId}`
                        messageKey += message
                        break
                    case isDisconnection && !isHostUser:
                        message = `dis:${payload as Number}`
                        messageKey += guessId + ":" + message
                        break
                    case isMessage && isHostUser:
                        message = `mes:${payload as NumberWithGuessIdWithBody}`
                        messageKey += getCutMessage(message, {body: true}, true)
                        break
                    case isMessage && !isHostUser:
                        message = `mes:${payload as NumberWithBody}`
                        messageKey += guessId + ":" + getCutMessage(message, {body: true}, false)
                        break
                    case isAcknowledge && isHostUser:
                        message = `ack:${payload as Number}`
                        messageKey += message
                        break
                    case isAcknowledge && !isHostUser:
                        message = `ack:${payload as Number}`
                        messageKey += guessId + ":" + message
                        break
                    default:
                        throw new Error("should had enter some case")
                }
                connection.sendUTF(message)
                cacheMessage(messageKey, message)
                const resendUntilAck = () => {
                    setTimeout(() => {
                        isMessageAck(messageKey).then(is => {
                            if (is) {
                                resendUntilAck()
                            } else {
                                connection.sendUTF(message)
                            }
                        })

                    }, 5000)
                }
                resendUntilAck()
            }

            subscribeToMessages(sendMessage, isHostUser, guessId)
            publishMessage("con", date + ":" + (isHostUser ? "" : guessId), !isHostUser, guessId)

            connection.on("message", (m) => {
                const utf8Data = (m as IUtf8Message).utf8Data as InboundMessage
                const prefix = utf8Data.substring(0, utf8Data.indexOf(":"))
                switch (prefix) {
                    case "mes":
                        break
                    case "ack":
                        break
                }

                publishMessage("mes", (m as IUtf8Message).utf8Data, isHostUser, guessId)
                console.log((new Date()) + " message: " + m)
            })
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
    const publishMessage: PublishMessage = (mp, payload, toHostUser, guessId) => {
        let channel
        switch (mp) {
            case "con":
                channel = getConnectionsChannel(toHostUser)
                break
            case "dis":
                channel = getDisconnectionsChannel(toHostUser)
                break
            case "mes":
                channel = getMessagesChannel(toHostUser, guessId)
                break
            case "ack":
                channel = getAcknowledgmentChannel(toHostUser, guessId)
                break
        }
        redisClient.publish(channel, payload)
    }

    const cacheMessage: CacheMessage = (key, message) => { redisClient.set(key, message) }
    const isMessageAck: IsMessageAck = async (key) => await redisClient.get(key) !== null

    initWebSocket(subscribeToMessages, publishMessage, cacheMessage, isMessageAck)
}

