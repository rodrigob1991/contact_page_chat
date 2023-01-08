import ws, {IUtf8Message} from "websocket"
import {createClient} from 'redis'
import http from "http"
import dotenv from "dotenv"
import {v4 as uuidv4} from 'uuid'
import {getIndexOnOccurrence} from "./utils/Strings"

//generic types
type GetTypesStartOnPrefix<TYPES extends string, PREFIXES extends string> = { [T in TYPES ]: T extends `${PREFIXES}${any}` ? T : never }[TYPES]
// type ProcessOne<T> = any
// type ForEach<U extends PropertyKey, <>P extends ProcessOne<?>> = { [M in U]: P<M> }[U]
//type GetUnionsIfExtend<T, S extends T[]>type GetPrefix<M extends Message> =  {[OM in M]: OM extends `${infer P}:${any}` ? P : never}
type UserType = "host" | "guess"
type MessageFlow = "in" | "out"
type MessagePrefix<MF extends MessageFlow=MessageFlow> = "mes" | "ack" | ("out" extends MF ? "con" | "dis" : never)
type MessageParts = { prefix: MessagePrefix, originPrefix: MessagePrefix<"out">, number: number, guessId: string, body: string }
type MessagePartsKeys = keyof MessageParts
type PartTemplate<MPK extends MessagePartsKeys, MPKS extends MessagePartsKeys, S extends ":" | ""> = MPK extends MPKS ? `${S}${MessageParts[MPK]}` : ""
type Separator<MP extends MessagePrefix | "", PMPKS extends MessagePartsKeys | "", MPKS extends MessagePartsKeys> = MP extends MessagePrefix ? ":" : ":" extends { [K in PMPKS]: K extends MPKS ? ":" : never }[PMPKS] ? ":" : ""
type MessageTemplate<MF extends MessageFlow | "", MP extends (MF extends MessageFlow ? MessagePrefix<MF> : "")  | "", MPKS extends MessagePartsKeys> =
    `${MP}${PartTemplate<"originPrefix", MPKS, Separator<MP, "", MPKS>>}${PartTemplate<"number", MPKS, Separator<MP, "originPrefix", MPKS>>}${PartTemplate<"guessId", MPKS, Separator<MP, "originPrefix" | "number", MPKS>>}${PartTemplate<"body", MPKS, Separator<MP, "originPrefix" | "number" | "guessId", MPKS>>}`
type GetPrefix<M extends Message> = { [OM in M]: OM extends `${infer P}:${any}` ? P : never }[M] & MessagePrefix
type CutMessage<M extends Message, CMPK extends SpecificMessagePartsKeys<M>> = MessageTemplate<MessageFlow, GetPrefix<M>, Exclude<SpecificMessagePartsKeys<M>, CMPK>>

// for now this is only for one message type, if a union is passed the result type will be unexpected
type MessagePartsPositions<M extends Message, MP = GetPrefix<M>> =
    { prefix: 1 } & (MP extends `${MessageTemplate<"in", "ack", "originPrefix" | "number">}${any}` ?
    { originPrefix: 2, number: 3 } & (M extends MessageTemplate<"in", "ack", "originPrefix" | "number" | "guessId"> ? { guessId: 4 } : {}) :
    { number: 2 } & (MP extends "mes" ?
    M extends MessageTemplate<MessageFlow, "mes", "number" | "guessId" | "body"> ?
        { guessId: 3, body: 4 } :
        { body: 3 } :
    M extends MessageTemplate<MessageFlow, MessagePrefix, "number" | "guessId"> ? { guessId: 3 } : {}))
type SpecificMessagePartsKeys<M extends Message> = { [OM in M]: keyof MessagePartsPositions<OM> }[M] & MessagePartsKeys
type SpecificMessagePartsPositionsValues<M extends Message> =  { [OM in M]: MessagePartsPositions<OM>[keyof MessagePartsPositions<OM>] }[M]

type OutboundToHostMesMessage = MessageTemplate<"out", "mes", "number" | "guessId" | "body">
type OutboundToHostConMessage = MessageTemplate<"out","con", "number" | "guessId">
type OutboundToHostDisMessage = MessageTemplate<"out","dis", "number" | "guessId">
type OutboundToHostAckMessage = MessageTemplate<"out","ack", "number">
type OutboundToGuessMesMessage = MessageTemplate<"out","mes", "number" | "body">
type OutboundToGuessConMessage = MessageTemplate<"out","con", "number">
type OutboundToGuessDisMessage = MessageTemplate<"out","dis", "number">
type OutboundToGuessAckMessage = MessageTemplate<"out","ack", "number">
type OutboundMesMessage<UT extends UserType> = ("host" extends UT ? OutboundToHostMesMessage : never) | ("guess" extends UT ? OutboundToGuessMesMessage : never)
type OutboundAckMessage<UT extends UserType> = ("host" extends UT ? OutboundToHostAckMessage : never) | ("guess" extends UT ? OutboundToGuessAckMessage : never)
type OutboundConMessage<UT extends UserType> = ("host" extends UT ? OutboundToHostConMessage : never) | ("guess" extends UT ? OutboundToGuessConMessage : never)
type OutboundDisMessage<UT extends UserType> = ("host" extends UT ? OutboundToHostDisMessage : never) | ("guess" extends UT ? OutboundToGuessDisMessage : never)
type OutboundMessage<UT extends UserType=UserType, MP extends MessagePrefix<"out">=MessagePrefix<"out">> = GetTypesStartOnPrefix<OutboundConMessage<UT> | OutboundDisMessage<UT> | OutboundMesMessage<UT> | OutboundAckMessage<UT>, MP>

type InboundFromHostMesMessage = MessageTemplate<"in","mes", "number" | "guessId" | "body">
type InboundFromHostAckMessage = MessageTemplate<"in","ack", "originPrefix" | "number" | "guessId">
type InboundFromGuessMesMessage = MessageTemplate<"in","mes", "number" | "body">
type InboundFromGuessAckMessage = MessageTemplate<"in","ack", "originPrefix" | "number">
type InboundMesMessage<UT extends UserType> = UT extends "host" ? InboundFromHostMesMessage : InboundFromGuessMesMessage
type InboundAckMessage<UT extends UserType> = UT extends "host" ? InboundFromHostAckMessage : InboundFromGuessAckMessage
type InboundMessage<UT extends UserType, MP extends MessagePrefix<"in">> = GetTypesStartOnPrefix<InboundMesMessage<UT> | InboundAckMessage<UT>, MP>

type Message<MF extends MessageFlow=MessageFlow, UT extends UserType=UserType, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = ("in" extends MF ? InboundMessage<UT, Exclude<MP, "con" | "dis">> : never)  | ("out" extends MF ? OutboundMessage<UT,MP> : never)

type HandleMesMessage<UT extends UserType> = (m: InboundMesMessage<UT>) => void
type HandleAckMessage<UT extends UserType> = (a: InboundAckMessage<UT> ) => void

type GuessId<UT extends UserType> = UT extends "guess" ? `:${MessageTemplate<"", "", "guessId">}` : ""
type Messa geKey<UT extends UserType, M extends OutboundMessage<UT>> = { [OM in M]: `${UT}${GuessId<UT>}:${CutMessage<OM, SpecificMessagePartsKeys<OM> & "body">}` }[M]

// @ts-ignore: the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type GetConMessageAndKey<UT extends UserType> = () => [OutboundConMessage<UT>, MessageKey<UT, OutboundConMessage<UT>>]
// @ts-ignore the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type GetDisMessageAndKey<UT extends UserType> = () => [OutboundDisMessage<UT>, MessageKey<UT, OutboundDisMessage<UT>>]
// @ts-ignore the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type GetMesMessageAndKey<UT extends UserType> = () => [OutboundMesMessage<UT>, MessageKey<UT, OutboundMesMessage<UT>>]
// @ts-ignore the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type GetAckMessageAndKey<UT extends UserType> = () => [OutboundAckMessage<UT>, MessageKey<UT, OutboundAckMessage<UT>>]

type RedisPayload<M extends OutboundMessage> = { [OM in M]: MessageTemplate<"", "", SpecificMessagePartsKeys<OM>> }[M]
type SendMessage = (mp: MessagePrefix<"out">, payload: RedisPayload<OutboundMessage>) => void
type SubscribeToMessages = (sendMessage: SendMessage, isHostUser: boolean, guessId?: string) => void
type PublishMessage = <M extends OutboundMessage,B extends boolean>(mp: MessagePrefix<"out">, payload: RedisPayload<M>, toHostUser: B, toGuessId: B extends false ? string : undefined) => void
// @ts-ignore the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type CacheMessage = <UT extends UserType, M extends OutboundMessage<UT>>(key: MessageKey<UT, OutboundMessage<UT>>, message: M) => void
// @ts-ignore the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type RemoveMessage = <UT extends UserType>(key: MessageKey<UT, OutboundMessage<UT>>) => void
// @ts-ignore the compiler does`t catch up that the first type param in MessageKey "UT" is the same in the type param of the second param in MessageKey "OutboundConMessage<UT>", and evaluate all possibilities
type IsMessageAck = <UT extends UserType>(key: MessageKey<UT, OutboundMessage<UT>>) => Promise<boolean>

type AnyMessagePartsPositions<M extends Message, SMPK extends SpecificMessagePartsKeys<M>, MPP= MessagePartsPositions<M>> = { [K in SMPK]: K extends keyof MPP ? MPP[K] : never }
type GotMessageParts<MPK extends MessagePartsKeys> = { [K in MPK]: MessageParts[K] }
type LastPosition<M extends Message, LASTS= [4, 3, 2, 1]> = LASTS extends [infer LAST, ...infer REST] ? LAST extends SpecificMessagePartsPositionsValues<M> ? LAST : LastPosition<M,REST> : never

const getMessageParts = <M extends Message, SMPK extends SpecificMessagePartsKeys<M>>(m: M, whatGet: AnyMessagePartsPositions<M, SMPK>) => {
    const messageParts: any = {}
    const getPartSeparatorIndex = (occurrence: number) => getIndexOnOccurrence(m, ":", occurrence)
    if ("prefix" in whatGet)
        messageParts["prefix"] = m.substring(0, 3)
    if ("originPrefix" in whatGet)
        messageParts["originPrefix"] = m.substring(4, 7)
    if ("number" in whatGet)
        messageParts["number"] = m.substring(8, getPartSeparatorIndex(whatGet.number as 2 | 3))
    if ("guessId" in whatGet) {
        const guessIdPosition = whatGet.guessId as 3 | 4
        messageParts["guessId"] = m.substring(getPartSeparatorIndex(guessIdPosition - 1) + 1, getPartSeparatorIndex(guessIdPosition))
    }
    if ("body" in whatGet)
        messageParts["body"] = m.substring(getPartSeparatorIndex((whatGet.body as 3 | 4) - 1) + 1, m.length - 1)

    return messageParts as GotMessageParts<SMPK>
}

const getCutMessage = <M extends Message, SMPK extends SpecificMessagePartsKeys<M>>(m: M, whatCut: AnyMessagePartsPositions<M, SMPK>, lastPosition: LastPosition<M>) => {
    let cutMessage: string = m
    let position = 0
    let cutSize = 0
    let cutCount = 0
    let partStartIndex = 0
    let partEndIndex = 0
    const findPartBoundaryIndex = (start = true) => {
        const currentPosition = position - cutCount
        let index
        if (currentPosition === 1 && start) {
            index = 0
        } else if (start) {
            index = getIndexOnOccurrence(cutMessage, ":", currentPosition - 1) + 1
        } else {
            index = getIndexOnOccurrence(cutMessage, ":", currentPosition) - 1
        }
        return index
    }
    const cut = () => {
        let cutStartIndex = partStartIndex - (position === lastPosition ? 1 : 0)
        let cutEndIndex = partEndIndex + (position === lastPosition ? 0 : 2)
        cutMessage = cutMessage.substring(0, cutStartIndex ) + cutMessage.substring(cutEndIndex)
        cutSize += cutEndIndex - cutStartIndex
        cutCount ++
    }

    if ("prefix" in whatCut) {
        position = 1
        partEndIndex = 2
        cut()
    }
    if ("originPrefix" in whatCut) {
        position = 2
        partStartIndex = 4 - cutSize
        partEndIndex = 6 - cutSize
        cut()
    }
    if ("number" in whatCut) {
        position = whatCut.number as 2 | 3
        partStartIndex = 8 - cutSize
        partEndIndex = findPartBoundaryIndex(false)
        cut()
    }
    if ("guessId" in whatCut) {
        position = whatCut.guessId as 3 | 4
        partStartIndex = findPartBoundaryIndex()
        partEndIndex = findPartBoundaryIndex(false)
        cut()
    }
    if ("body" in whatCut) {
        position = whatCut.body as 3 | 4
        partEndIndex = findPartBoundaryIndex()
        partEndIndex = m.length - 1
        cut()
    }

    return cutMessage as CutMessage<M, SMPK>
}

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
const initWebSocket = (subscribeToMessages : SubscribeToMessages, publishMessage: PublishMessage, cacheMessage: CacheMessage, removeMessage: RemoveMessage, isMessageAck: IsMessageAck) => {
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

            /*const getMessageKey = <UT extends UserType, M extends OutboundMessage<UT>>(m: M) => {
                return `${userType}:${mp}:${r}`
            }*/

            const sendMessageToHost: SendMessage = (mp, payload) => {
                const getConMessageAndKey: GetConMessageAndKey<"host"> = () => {
                    const message: OutboundToHostConMessage = `con:${payload as RedisPayload<OutboundToHostConMessage>}`
                    const key: MessageKey<"host", OutboundToHostConMessage> = `host:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey<"host"> = () => {
                    const message: OutboundToHostDisMessage = `dis:${payload as RedisPayload<OutboundToHostDisMessage>}`
                    const key: MessageKey<"host", OutboundToHostDisMessage> = `host:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey<"host"> = () => {
                    const message: OutboundToHostMesMessage = `mes:${payload as RedisPayload<OutboundToHostMesMessage>}`
                    const key: MessageKey<"host", OutboundToHostMesMessage> = `host:${getCutMessage(message, {body: 4}, 4)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey<"host"> = () => {
                    const message: OutboundToHostAckMessage = `ack:${payload as  RedisPayload<OutboundToHostAckMessage>}`
                    const key: MessageKey<"host", OutboundToHostAckMessage> = `host:${message}`
                    return [message, key]
                }
                sendMessage(mp, getConMessageAndKey, getDisMessageAndKey, getMesMessageAndKey, getAckMessageAndKey)
            }
            const sendMessageToGuess: SendMessage = (mp, payload) => {
                const getConMessageAndKey: GetConMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessConMessage = `con:${payload as RedisPayload<OutboundToGuessConMessage>}`
                    const key: MessageKey<"guess", OutboundToGuessConMessage> = `guess:${guessId}:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessDisMessage = `dis:${payload as RedisPayload<OutboundToGuessDisMessage>}`
                    const key: MessageKey<"guess", OutboundToGuessDisMessage> = `guess:${guessId}:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessMesMessage = `mes:${payload as RedisPayload<OutboundToGuessMesMessage>}`
                    const key: MessageKey<"guess", OutboundToGuessMesMessage> = `guess:${guessId}:${getCutMessage(message, {body: 3}, 3)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey<"guess"> = () => {
                    const message: OutboundToGuessAckMessage = `ack:${payload as RedisPayload<OutboundToGuessAckMessage>}`
                    const key: MessageKey<"guess", OutboundToGuessAckMessage> = `guess:${guessId}:${message}`
                    return [message, key]
                }
                sendMessage(mp, getConMessageAndKey, getDisMessageAndKey, getMesMessageAndKey, getAckMessageAndKey)
            }

            const sendMessage = <UT extends UserType, MP extends MessagePrefix>(mp: P, getConMessageAndKey: GetConMessageAndKey<UT>, getDisMessageAndKey: GetDisMessageAndKey<UT>, getMesMessageAndKey: GetMesMessageAndKey<UT>,getAckMessageAndKey: GetAckMessageAndKey<UT>) => {
                let message : OutboundMessage
                let key: any
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

            subscribeToMessages(isHostUser ? sendMessageToHost : sendMessageToGuess, isHostUser, guessId)
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
                    const {number, guessId: toGuessId, body} = getMessageParts(m, {number: 2, guessId: 3, body: 4})
                    publishMessage("mes", number + ":" + body, false, toGuessId)
                }
                const handleAckMessage: HandleAckMessage<"host"> = (a) => {
                    const {originPrefix, number, guessId: toGuessId} = getMessageParts(a, {originPrefix: 2, number: 3, guessId: 4})
                    removeMessage(getMessageKey("originPrefix"))
                    if (originPrefix === "mes")
                    publishMessage("ack", number, false, toGuessId)
                }
                handleMessage(m, handleMesMessage, handleAckMessage)
            }
            const handleMessageFromGuess = (m: ws.Message) => {
                const handleMesMessage: HandleMesMessage<"guess"> = (m) => {
                    const {number, body} = getMessageParts(m, {number: 2, body: 3})
                    publishMessage("mes", number + ":" + guessId + ":" + body, true, undefined)
                }
                const handleAckMessage: HandleAckMessage<"guess"> = (a) => {
                    const {originPrefix, number} = getMessageParts(a, {originPrefix: 2, number: 3})
                    removeMessage(getMessageKey("originPrefix"))
                    if (originPrefix === "mes")
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

        await subscriber.subscribe(getConnectionsChannel(isHostUser), (payload, channel) => {
            sendMessage("con", payload)
        })
        await subscriber.subscribe(getDisconnectionsChannel(isHostUser), (payload, channel) => {
            sendMessage("dis", payload)
        })
        await subscriber.subscribe(getMessagesChannel(isHostUser, guessId), (payload, channel) => {
            sendMessage("mes", payload)
        })
        await subscriber.subscribe(getAcknowledgmentChannel(isHostUser, guessId), (payload, channel) => {
            sendMessage("ack", payload)
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
    const removeMessage: RemoveMessage = (key) => { redisClient.del(key) }
    const isMessageAck: IsMessageAck = async (key) => await redisClient.get(key) === null

    initWebSocket(subscribeToMessages, publishMessage, cacheMessage, removeMessage, isMessageAck)
}

dotenv.config()
init()


