import ws, {IUtf8Message} from "websocket"
import {createClient} from 'redis'
import http from "http"
import dotenv from "dotenv"
import {getIndexOnOccurrence} from "./utils/Strings"

//generic types
// type IsUnion<U extends string> = { [M in U]: U extends M ? false : true }[U]
// type GetTypesStartOnPrefix<U extends string, P extends string> = { [M in U]: IsUnion<M> extends true ? GetTypesStartOnPrefix<M, P> : M extends `${infer MT}` ? MT extends `${P}${any}` ? MT : never : never }[U]

type UserType = "host" | "guess"
type MessageFlow = "in" | "out"
type MessagePrefix<MF extends MessageFlow=MessageFlow> = "mes" | "ack" | ("out" extends MF ? "con" | "dis" : never)
type MessageParts = { prefix: MessagePrefix, originPrefix: MessagePrefix<"out">, number: number, guessId: number, body: `-${string}`}
type MessagePartsKeys = keyof MessageParts
type PartTemplate<MPK extends MessagePartsKeys, MPKS extends MessagePartsKeys, S extends ":" | ""> = MPK extends MPKS ? `${S}${MessageParts[MPK]}` : ""
//type Separator<MP extends MessagePrefix | "", PMPKS extends MessagePartsKeys | "", MPKS extends MessagePartsKeys> = MP extends MessagePrefix ? ":" : ":" extends { [K in PMPKS]: K extends MPKS ? ":" : never }[PMPKS] ? ":" : ""
type MessageTemplateInstance<MP extends MessagePrefix, MPKS extends MessagePartsKeys> =
    `${MP}${PartTemplate<"originPrefix", MPKS, ":">}${PartTemplate<"number", MPKS, ":">}${PartTemplate<"guessId", MPKS, ":">}${PartTemplate<"body", MPKS, ":">}`
//type CutMessage<MP extends MessageParts, WC extends MessagePartsKeys>= { [OMP in MP]: SpecificMessagePartsKeys<OMP> extends infer SMPK ? MessageTemplateInstance<Extract<SMPK,MessagePrefix>, Exclude<SMPK, WC>> : never}[MP]
// for now this is only for one message type, if a union is passed the result type will be unexpected
/*type MessagePartsPositions<M extends Message, MP = GetPrefix<M>> = {
    [OM in M]: { prefix: 1 } & (M extends `${MessageTemplate<"in", "ack", "originPrefix" | "number">}${any}` ?
    { originPrefix: 2, number: 3 } & (M extends InboundFromHostAckMessage ? { guessId: 4 } : {}) :
    { number: 2 } & (MP extends "mes" ?
    M extends MessageTemplate<MessageFlow, "mes", "number" | "guessId" | "body"> ?
        { guessId: 3, body: 4 } :
        { body: 3 } :
    M extends MessageTemplate<MessageFlow, MessagePrefix, "number" | "guessId"> ? { guessId: 3 } : {}))
}[M]*/
/*type MessagePartsPositions<UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>> =
    { prefix: 1 } & (MP | MF  extends "ack" | "in" ? { originPrefix: 2, number: 3} & (UT extends "host" ? { guessId: 4 } : {})
    : { number: 2 } & (MP extends "mes" ?*/
//type SpecificMessagePartsKeys<M extends Message> = { [OM in M]: keyof MessagePartsPositions<OM> }[M] & MessagePartsKeys
//type SpecificMessagePartsPositionsValues<M extends Message, MP = MessagePartsPositions<M>> = { [K in keyof MP]: MP[K] }[keyof MP]

type SpecificMessagePartsKeys<UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>> =
    "prefix"
    | ("in" | "ack" extends MF | MP ? "originPrefix" : never)
    | "number"
    | ("mes" extends MP ? "body" : never)
    | ("host" extends UT ? MF | MP extends "out" | "ack" ? never : "guessId" : never)
/*
type SpecificMessagePartsKeys<MP extends MessageParts | string> = MP extends `${infer P}:${infer R}` ? P extends MessagePartsKeys ? P | SpecificMessagePartsKeys<R> : never  : never
type SpecificMessagePartsKeysCombined<UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>> =
    `prefix${"in" | "ack" extends MF | MP ? ":originPrefix" : ""}:number${"mes" extends MP ? ":body" : ""}${"host" extends UT ? MF | MP extends "out" | "ack" ? "" : ":guessId" : ""}`
*/
type SpecificMessagePartsPositions<SMPK extends MessagePartsKeys> = Pick<{ prefix: 1, originPrefix: 2, number: "originPrefix" extends SMPK ? 3 : 2, guessId: "originPrefix" extends SMPK ? 4 : 3, body: "guessId" extends SMPK ? 4 : 3 }, SMPK>
//type GetSpecificMessagePartsKeys<SMPP extends SpecificMessagePartsPositions<UserType, MessageFlow, MessagePrefix> =
type MessageInstance<UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>, SMPK extends SpecificMessagePartsKeys<UT, MF, MP> = SpecificMessagePartsKeys<UT, MF, MP>> = { userType: UT, flow: MF, prefix: MP, parts: SMPK, positions: SpecificMessagePartsPositions<SMPK>, template: MessageTemplateInstance<MP, SMPK> }

type OutboundToHostMesMessage = MessageInstance<"host", "out", "mes">
type OutboundToHostConMessage = MessageInstance<"host", "out", "con">
type OutboundToHostDisMessage = MessageInstance<"host", "out", "dis">
type OutboundToHostAckMessage = MessageInstance<"host", "out", "ack">
type OutboundToGuessMesMessage = MessageInstance<"guess", "out", "mes">
type OutboundToGuessConMessage = MessageInstance<"guess", "out", "con">
type OutboundToGuessDisMessage = MessageInstance<"guess", "out", "dis">
type OutboundToGuessAckMessage = MessageInstance<"guess", "out", "ack">
type OutboundMesMessage<UT extends UserType=UserType> = ("host" extends UT ? OutboundToHostMesMessage : never) | ("guess" extends UT ? OutboundToGuessMesMessage : never)
type OutboundAckMessage<UT extends UserType=UserType> = ("host" extends UT ? OutboundToHostAckMessage : never) | ("guess" extends UT ? OutboundToGuessAckMessage : never)
type OutboundConMessage<UT extends UserType=UserType> = ("host" extends UT ? OutboundToHostConMessage : never) | ("guess" extends UT ? OutboundToGuessConMessage : never)
type OutboundDisMessage<UT extends UserType=UserType> = ("host" extends UT ? OutboundToHostDisMessage : never) | ("guess" extends UT ? OutboundToGuessDisMessage : never)
type OutboundMessage<UT extends UserType=UserType, MP extends MessagePrefix<"out">=MessagePrefix<"out">> = ("con" extends MP ? OutboundConMessage<UT> : never) | ("dis" extends MP ? OutboundDisMessage<UT>: never)  | ("mes" extends MP ? OutboundMesMessage<UT>: never)  | ("ack" extends MP ? OutboundAckMessage<UT>: never)
// i dont`t use this way because the compiler cannot always infer the type
//type OutboundMessage<UT extends UserType=UserType, MP extends MessagePrefix<"out">=MessagePrefix<"out">> = GetTypesStartOnPrefix<OutboundConMessage<UT> | OutboundDisMessage<UT> | OutboundMesMessage<UT> | OutboundAckMessage<UT>, MP>
type OutboundMessageParts<UT extends UserType=UserType, MP extends MessagePrefix<"out">=MessagePrefix<"out">> = OutboundMessage<UT, MP>["parts"]
type OutboundMessageTemplate<UT extends UserType=UserType, MP extends MessagePrefix<"out">=MessagePrefix<"out">> = OutboundMessage<UT, MP>["template"]

type InboundFromHostMesMessage = MessageInstance<"host","in","mes">
type InboundFromHostAckMessage = MessageInstance<"host","in","ack">
type InboundFromGuessMesMessage = MessageInstance<"guess","in","mes">
type InboundFromGuessAckMessage = MessageInstance<"guess","in","ack">
type InboundMesMessage<UT extends UserType=UserType> =   ("host" extends UT ? InboundFromHostMesMessage : never)  | ("guess" extends UT ? InboundFromGuessMesMessage : never)
type InboundAckMessage<UT extends UserType=UserType> = ("host" extends UT ? InboundFromHostAckMessage  : never) | ("guess" extends UT ? InboundFromGuessAckMessage : never)
type InboundMessage<UT extends UserType=UserType, MP extends MessagePrefix<"in">=MessagePrefix<"in">> =("mes" extends MP ? InboundMesMessage<UT> : never) | ("ack" extends MP ? InboundAckMessage<UT> : never)
// i dont`t use this way because the compiler cannot always infer the type
//type InboundMessage<UT extends UserType=UserType, MP extends MessagePrefix<"in">=MessagePrefix<"in">> = GetTypesStartOnPrefix<InboundMesMessage<UT> | InboundAckMessage<UT>,MP>
type InboundMessageParts<UT extends UserType=UserType, MP extends MessagePrefix<"in">=MessagePrefix<"in">> = InboundMessage<UT, MP>["parts"]
type InboundMessageTemplate<UT extends UserType=UserType, MP extends MessagePrefix<"in">=MessagePrefix<"in">> = InboundMessage<UT, MP>["template"]
type InboundMessageTarget<UT extends UserType, MP extends MessagePrefix<"in">> = OutboundMessage<UserType extends UT ? UT : Exclude<UserType, UT>, MP>

type Message<UT extends UserType=UserType, MF extends MessageFlow=MessageFlow, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = ("in" extends MF ? InboundMessage<UT, Exclude<MP, "con" | "dis">> : never)  | ("out" extends MF ? OutboundMessage<UT,MP> : never)
type MessagePartsPositions<UT extends UserType=UserType, MF extends MessageFlow=MessageFlow, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = Message<UT, MF, MP>["positions"]
type MessageTemplate<UT extends UserType=UserType, MF extends MessageFlow=MessageFlow, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = Message<UT, MF, MP>["template"]

type FilterMessage<M extends Message, UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>> = M["userType"] | M["flow"] | M["prefix"] extends UT | MF | MP ? M : never
type GetMessages<UT extends UserType = UserType, MF extends MessageFlow = MessageFlow, MP extends MessagePrefix<MF> = MessagePrefix<MF>> = [FilterMessage<OutboundToHostMesMessage, UT, MF, MP>, FilterMessage<OutboundToHostConMessage, UT, MF, MP>, FilterMessage<OutboundToHostDisMessage, UT, MF, MP>, FilterMessage<OutboundToHostAckMessage, UT, MF, MP>,
    FilterMessage<OutboundToGuessMesMessage, UT, MF, MP>, FilterMessage<OutboundToGuessConMessage, UT, MF, MP>, FilterMessage<OutboundToGuessDisMessage, UT, MF, MP>, FilterMessage<OutboundToGuessAckMessage, UT, MF, MP>, FilterMessage<InboundFromHostMesMessage, UT, MF, MP>, FilterMessage<InboundFromHostAckMessage, UT, MF, MP>,
    FilterMessage<InboundFromGuessMesMessage, UT, MF, MP>, FilterMessage<InboundFromGuessAckMessage, UT, MF, MP>]

type HandleMesMessage<UT extends UserType> = (m: InboundMessageTemplate<UT, "mes">) => void
type HandleAckMessage<UT extends UserType> = (a: InboundMessageTemplate<UT, "ack">) => void

type RedisMessageKey<M extends OutboundMessage[] = GetMessages<UserType, "out", MessagePrefix<"out">>> = M extends [infer OM, ...infer RM] ? OM extends OutboundMessage ? `${OM["userType"]}${OM["userType"] extends "guess" ? `:${MessageParts["guessId"]}` : ""}:${MessageTemplateInstance<OM["prefix"], Exclude<OM["parts"], "body">>}` | (RM extends OutboundMessage[] ? RedisMessageKey<RM> : never) : never : never
// the message less the prefix
type RedisMessagePayload<MT extends OutboundMessageTemplate> = { [OMT in MT]: OMT extends `${MessagePrefix<"out">}:${infer R}` ? R : never }[MT]

type MessageAndKeyResult<M extends OutboundMessage> = [M["template"], RedisMessageKey<[M]>]
type GetConMessageAndKey = () => MessageAndKeyResult<OutboundConMessage>
type GetDisMessageAndKey = () => MessageAndKeyResult<OutboundDisMessage>
type GetMesMessageAndKey = () => MessageAndKeyResult<OutboundMesMessage>
type GetAckMessageAndKey = () => MessageAndKeyResult<OutboundAckMessage>

type SendMessage = (mp: MessagePrefix<"out">, payload: RedisMessagePayload<OutboundMessageTemplate>) => void
type GuessId<UT extends UserType> =
    ("guess" extends UT ? MessageParts["guessId"] : never)
    | ("host" extends UT ? undefined : never)
type SubscribeToMessages = (sendMessage: SendMessage, isHostUser: boolean, guessId: GuessId<UserType>) => void
type PublishMessage = <M extends OutboundMessage>(mp: M["prefix"], payload: RedisMessagePayload<M["template"]>, toUser: M["userType"], toGuessId: GuessId<M["userType"]>) => void
type CacheMessage = <M extends OutboundMessage>(key: RedisMessageKey<[M]>, message: M["template"]) => void
type RemoveMessage = <M extends OutboundMessage>(key: RedisMessageKey<[M]>) => void
type IsMessageAck = <M extends OutboundMessage>(key: RedisMessageKey<[M]>) => Promise<boolean>

type AnyMessagePartsPositions<M extends Message, SMPK extends SpecificMessagePartsKeys<M>> = { [OM in M]: { [K in SMPK as K extends SpecificMessagePartsKeys<OM> ? K : never]: K extends keyof MessagePartsPositions<OM> ? MessagePartsPositions<OM>[K] : never } }[M]
type GotMessageParts<M extends Message, SMPK extends SpecificMessagePartsKeys<M>> = { [K in SMPK]: { [OM in M]: K extends SpecificMessagePartsKeys<OM> ? MessageParts[K] : undefined }[M] }
type LastPosition<M extends Message, LASTS= [4, 3, 2, 1]> = LASTS extends [infer LAST, ...infer REST] ? LAST extends SpecificMessagePartsPositionsValues<M> ? LAST : LastPosition<M,REST> : never

// should be added the
const getMessageParts = <M extends Message, SMPK extends SpecificMessagePartsKeys<M>>(m: M["template"], whatGet: AnyMessagePartsPositions<M, SMPK>) => {
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

    return messageParts as GotMessageParts<M, SMPK>
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

            // generate an unique number for each guess connected
            const guessId = userType === "host" ? undefined : date

            const sendMessageToHost: SendMessage = (mp, payload) => {
                const getConMessageAndKey: GetConMessageAndKey = () => {
                    const message: OutboundToHostConMessage["template"] = `con:${payload as RedisMessagePayload<OutboundToHostConMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToHostConMessage]> = `host:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey = () => {
                    const message: OutboundToHostDisMessage = `dis:${payload as RedisPayload<OutboundToHostDisMessage>}`
                    const key: RedisMessageKey<"host", OutboundToHostDisMessage> = `host:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey = () => {
                    const message: OutboundToHostMesMessage = `mes:${payload as RedisPayload<OutboundToHostMesMessage>}`
                    const key: RedisMessageKey<"host", OutboundToHostMesMessage> = `host:${getCutMessage<OutboundToHostMesMessage, "body">(message, {body: 4}, 4)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey = () => {
                    const message: OutboundToHostAckMessage = `ack:${payload as  RedisPayload<OutboundToHostAckMessage>}`
                    const key: RedisMessageKey<"host", OutboundToHostAckMessage> = `host:${message}`
                    return [message, key]
                }
                sendMessage(mp, getConMessageAndKey, getDisMessageAndKey, getMesMessageAndKey, getAckMessageAndKey)
            }
            const sendMessageToGuess: SendMessage = (mp, payload) => {
                const getConMessageAndKey: GetConMessageAndKey = () => {
                    const message: OutboundToGuessConMessage = `con:${payload as RedisPayload<OutboundToGuessConMessage>}`
                    const key: RedisMessageKey<"guess", OutboundToGuessConMessage> = `guess:${guessId as number}:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey = () => {
                    const message: OutboundToGuessDisMessage = `dis:${payload as RedisPayload<OutboundToGuessDisMessage>}`
                    const key: RedisMessageKey<"guess", OutboundToGuessDisMessage> = `guess:${guessId as number}:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey = () => {
                    const message: OutboundToGuessMesMessage = `mes:${payload as RedisPayload<OutboundToGuessMesMessage>}`
                    const key: RedisMessageKey<"guess", OutboundToGuessMesMessage> = `guess:${guessId as number}:${getCutMessage<OutboundToGuessMesMessage, "body">(message, {body: 3}, 3)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey = () => {
                    const message: OutboundToGuessAckMessage = `ack:${payload as RedisPayload<OutboundToGuessAckMessage>}`
                    const key: RedisMessageKey<"guess", OutboundToGuessAckMessage> = `guess:${guessId as number}:${message}`
                    return [message, key]
                }
                sendMessage(mp, getConMessageAndKey, getDisMessageAndKey, getMesMessageAndKey, getAckMessageAndKey)
            }

            const sendMessage = (mp: MessagePrefix, getConMessageAndKey: GetConMessageAndKey, getDisMessageAndKey: GetDisMessageAndKey, getMesMessageAndKey: GetMesMessageAndKey,getAckMessageAndKey: GetAckMessageAndKey) => {
                let message : OutboundMessage
                let key: RedisMessageKey
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
                cacheMessage(key, message)
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
            publishMessage<UserType, OutboundConMessage>("con", `${date}${(guessId ? `:${guessId}` : "") as `:${number}`}`, userType, guessId)

            const handleMessage = <UT extends UserType>(m: ws.Message, handleMesMessage: HandleMesMessage<UT>, handleAckMessage: HandleAckMessage<UT>) => {
                const utf8Data = (m as IUtf8Message).utf8Data as InboundMessage<UT>
                const {prefix} = getMessageParts<InboundMessage, "prefix">(utf8Data, {prefix: 1})
                switch (prefix) {
                    case "mes":
                        handleMesMessage(utf8Data as InboundMesMessage)
                        break
                    case "ack":
                        handleAckMessage(utf8Data as InboundAckMessage)
                        break
                }
                console.log((new Date()) + " message: " + m)
            }
            const handleMessageFromHost = (m: ws.Message) => {
                const handleMesMessage: HandleMesMessage<"host"> = (m) => {
                    const {number, guessId: toGuessId, body} = getMessageParts<InboundFromHostMesMessage, "number" | "guessId" | "body">(m, {number: 2, guessId: 3, body: 4})
                    const redisPayload : RedisPayload<InboundMessageTarget<"host", "mes">> = `${number}:${body}`
                    publishMessage("mes", redisPayload, "guess", toGuessId)
                }
                const handleAckMessage: HandleAckMessage<"guess"> = (a) => {
                    const {originPrefix, number, guessId: toGuessId} = getMessageParts<InboundFromHostAckMessage, "number" | "guessId" | "originPrefix">(a, {originPrefix: 2, number: 3, guessId: 4})
                    //removeMessage(getMessageKey("originPrefix"))
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