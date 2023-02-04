import ws, {IUtf8Message} from "websocket"
import {createClient} from 'redis'
import http from "http"
import dotenv from "dotenv"
import {getIndexOnOccurrence} from "./utils/Strings"

//generic types
// type GetTypesStartOnPrefix<U extends string, P extends string> = { [M in U]: IsUnion<M> extends true ? GetTypesStartOnPrefix<M, P> : M extends `${infer MT}` ? MT extends `${P}${any}` ? MT : never : never }[U]
type UserType = "host" | "guess"
type MessageFlow = "in" | "out"
type MessagePrefix<MF extends MessageFlow=MessageFlow> = "mes" | "ack" | ("out" extends MF ? "con" | "dis" : never)
type MessageParts = { prefix: MessagePrefix, originPrefix: MessagePrefix<"out">, number: number, guessId: number, body: `-${string}`}
type MessagePartsKeys = keyof MessageParts
type PartTemplate<MPK extends MessagePartsKeys, MPKS extends MessagePartsKeys, S extends ":" | ""> = MPK extends MPKS ? `${S}${MessageParts[MPK]}` : ""
type MessageTemplateInstance<MP extends MessagePrefix, MPKS extends MessagePartsKeys> =
    `${MP}${PartTemplate<"originPrefix", MPKS, ":">}${PartTemplate<"number", MPKS, ":">}${PartTemplate<"guessId", MPKS, ":">}${PartTemplate<"body", MPKS, ":">}`
type CutMessage<M extends Message[], WC extends MessagePartsKeys> = M extends [infer OM, ...infer RM] ? OM extends Message ? MessageTemplateInstance<OM["prefix"], Exclude<OM["parts"], WC>> | (RM extends Message[] ? CutMessage<RM, WC> : never) : never : never

type SpecificMessagePartsKeys<UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>> =
    "prefix"
    | ("in" | "ack" extends MF | MP ? "originPrefix" : never)
    | "number"
    | ("mes" extends MP ? "body" : never)
    | ("host" extends UT ? MF | MP extends "out" | "ack" ? never : "guessId" : never)

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
type InboundMessageTarget<M extends InboundMessage, UT = M["userType"]> = OutboundMessage<UserType extends M["userType"] ? M["userType"] : Exclude<UserType, UT>,  M["prefix"]>
type InboundAckMessageOrigin<UT extends UserType = UserType, OP extends MessagePrefix<"out"> = MessagePrefix<"out">> = OutboundMessage<UT, OP>

type Message<UT extends UserType=UserType, MF extends MessageFlow=MessageFlow, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = ("in" extends MF ? InboundMessage<UT, Exclude<MP, "con" | "dis">> : never)  | ("out" extends MF ? OutboundMessage<UT,MP> : never)
type MessagePartsPositions<UT extends UserType=UserType, MF extends MessageFlow=MessageFlow, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = Message<UT, MF, MP>["positions"]
type MessageTemplate<UT extends UserType=UserType, MF extends MessageFlow=MessageFlow, MP extends MessagePrefix<MF>=MessagePrefix<MF>> = Message<UT, MF, MP>["template"]

type FilterMessage<M extends Message, UT extends UserType, MF extends MessageFlow, MP extends MessagePrefix<MF>> = M["userType"] | M["flow"] | M["prefix"] extends UT | MF | MP ? [M] : []
type GetMessages<UT extends UserType = UserType, MF extends MessageFlow = MessageFlow, MP extends MessagePrefix<MF> = MessagePrefix<MF>> = [...FilterMessage<OutboundToHostMesMessage, UT, MF, MP>, ...FilterMessage<OutboundToHostConMessage, UT, MF, MP>, ...FilterMessage<OutboundToHostDisMessage, UT, MF, MP>, ...FilterMessage<OutboundToHostAckMessage, UT, MF, MP>,
    ...FilterMessage<OutboundToGuessMesMessage, UT, MF, MP>, ...FilterMessage<OutboundToGuessConMessage, UT, MF, MP>, ...FilterMessage<OutboundToGuessDisMessage, UT, MF, MP>, ...FilterMessage<OutboundToGuessAckMessage, UT, MF, MP>, ...FilterMessage<InboundFromHostMesMessage, UT, MF, MP>, ...FilterMessage<InboundFromHostAckMessage, UT, MF, MP>,
    ...FilterMessage<InboundFromGuessMesMessage, UT, MF, MP>, ...FilterMessage<InboundFromGuessAckMessage, UT, MF, MP>]

type HandleMesMessage<UT extends UserType> = (m: InboundMessageTemplate<UT, "mes">) => void
type HandleAckMessage<UT extends UserType> = (a: InboundMessageTemplate<UT, "ack">) => void

type RedisMessageKey<M extends OutboundMessage[] = GetMessages<UserType, "out", MessagePrefix<"out">>> = M extends [infer OM, ...infer RM] ? OM extends OutboundMessage ? `${OM["userType"]}${OM["userType"] extends "guess" ? `:${MessageParts["guessId"]}` : ""}:${CutMessage<[OM], "body">}` | (RM extends OutboundMessage[] ? RedisMessageKey<RM> : never) : never : never
type GetRedisMessageKeyParams<M extends OutboundMessage> = { [K in Exclude<M["parts"], "body">]: MessageParts[K] }
type GetRedisMessageKey = <M extends OutboundMessage>(params: GetRedisMessageKeyParams<M>)=> RedisMessageKey<[M]>
// the message less the prefix
type RedisMessagePayload<MT extends OutboundMessageTemplate> = { [OMT in MT]: OMT extends `${MessagePrefix<"out">}:${infer R}` ? R : never }[MT]

type MessageAndKeyResult<M extends OutboundMessage> = [M["template"], RedisMessageKey<[M]>]
type GetConMessageAndKey = () => MessageAndKeyResult<OutboundConMessage>
type GetDisMessageAndKey = () => MessageAndKeyResult<OutboundDisMessage>
type GetMesMessageAndKey = () => MessageAndKeyResult<OutboundMesMessage>
type GetAckMessageAndKey = () => MessageAndKeyResult<OutboundAckMessage>

type SendMessage<UT extends UserType> = (message: OutboundMessageTemplate<UT>) => void
type GuessIdToSubscribe<UT extends UserType> = ("guess" extends UT ? MessageParts["guessId"] : never) | ("host" extends UT ? undefined : never)
type SubscribeToMessages = <UT extends UserType>(sendMessage: SendMessage<UT>, ofUserType: UT, guessId: GuessIdToSubscribe<UT>) => void
type GuessIdToPublish<UT extends UserType, MP extends MessagePrefix> = UT extends "guess" ? MP extends "mes" | "ack" ? MessageParts["guessId"] : undefined : undefined
// only for one message type, no unions.
type PublishMessage = <M extends OutboundMessage>(messageParts: GetMessageParams<M>, toUserType: M["userType"], toGuessId: GuessIdToPublish<M["userType"], M["prefix"]>) => void
type CacheMessage = <M extends OutboundMessage>(key: RedisMessageKey<[M]>, message: M["template"]) => void
type RemoveMessage = <M extends OutboundMessage>(key: RedisMessageKey<[M]>) => void
type IsMessageAck = <M extends OutboundMessage>(key: RedisMessageKey<[M]>) => Promise<boolean>

// this is to filter the position that are not unions
type IfUniquePosition<P, K> = { [N in 1 | 2 | 3 | 4]: N extends P ? Exclude<P, N> extends never ? K : never : never }[1 | 2 | 3 | 4]
type CommonMessagePartsPositions<M extends Message, MPP = M["positions"]> = keyof { [K in M["parts"] as K extends keyof MPP ? IfUniquePosition<MPP[K], K> : never]: never }
type AnyMessagePartsPositions<M extends Message, CMPP extends CommonMessagePartsPositions<M>, MPP = M["positions"]> = { [K in CMPP]: K extends keyof MPP ? MPP[K] : never }
type GotMessageParts<M extends Message, CMPP extends CommonMessagePartsPositions<M>> = { [K in CMPP]: MessageParts[K] }
type LastPosition<MPP extends MessagePartsPositions, LASTS = [4, 3, 2, 1]> = LASTS extends [infer LAST, ...infer REST] ? LAST extends MPP[keyof MPP] ? LAST : LastPosition<MPP, REST> : never
type GetMessageParams<M extends Message> = { [K in keyof M["positions"] | "prefix"]: K extends "prefix" ? M["prefix"] : K extends MessagePartsKeys ? MessageParts[K] : never }

const getMessage = <M extends Message>(parts: GetMessageParams<M>) => {
    let message = ""
    if ("prefix" in parts)
        message += parts.prefix
    if ("originPrefix" in parts)
        message += ":" + parts.originPrefix
    if ("number" in parts)
        message += ":" + parts.number
    if ("guessId" in parts)
        message += ":" + parts.guessId
    if ("body" in parts)
        message += ":" + parts.body

    return message as M["template"]
}

const getMessageParts = <M extends Message, CMPP extends CommonMessagePartsPositions<M>>(m: M["template"], whatGet: AnyMessagePartsPositions<M, CMPP>) => {
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

    return messageParts as GotMessageParts<M, CMPP>
}

const getCutMessage = <M extends Message, CMPP extends CommonMessagePartsPositions<M>, MPP extends M["positions"] = M["positions"]>(m: M["template"], whatCut: AnyMessagePartsPositions<M, CMPP>, lastPosition: LastPosition<MPP>) => {
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

    return cutMessage as CutMessage<[M], CMPP>
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

            const userType: UserType = request.httpRequest.headers.host_user === process.env.HOST_USER_SECRET ? "host" : "guess"
            // TODO: generate a unique number for each guess connected
            const guessId = userType === "guess" ? date : undefined

            const getRedisMessageKey: GetRedisMessageKey = (params) => {

            }

            const sendMessageToHost: SendMessage<"host"> = (message) => {
                let key: RedisMessageKey<GetMessages<"host", "out">>
                const mp = getMessageParts<OutboundMessage<"host">, "prefix">(message, {prefix: 1}).prefix
                switch (mp) {
                    case "con":
                    case "dis":
                    case "ack":
                        key = `host:${message as OutboundMessageTemplate<"host", "con" | "dis" | "ack">}`
                        break
                    case "mes":
                        key = `host:${getCutMessage<OutboundMessage<"host", "mes">, "body">(message as OutboundMessageTemplate<"host", "mes">, {body: 4}, 4)}`
                        break
                    default:
                        throw new Error("invalid message prefix")
                }


                /*const getConMessageAndKey: GetConMessageAndKey = () => {
                    const message: OutboundToHostConMessage["template"] = `con:${payload as RedisMessagePayload<OutboundToHostConMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToHostConMessage]> = `host:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey = () => {
                    const message: OutboundToHostDisMessage["template"] = `dis:${payload as RedisMessagePayload<OutboundToHostDisMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToHostDisMessage]> = `host:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey = () => {
                    const message: OutboundToHostMesMessage["template"] = `mes:${payload as RedisMessagePayload<OutboundToHostMesMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToHostMesMessage]> = `host:${getCutMessage<OutboundToHostMesMessage, "body">(message, {body: 4}, 4)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey = () => {
                    const message: OutboundToHostAckMessage["template"] = `ack:${payload as  RedisMessagePayload<OutboundToHostAckMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToHostAckMessage]> = `host:${message}`
                    return [message, key]
                }*/
                sendMessage(key, message)
            }
            const sendMessageToGuess: SendMessage<"guess"> = (message) => {
                let key: RedisMessageKey<GetMessages<"guess", "out">>
                const mp = getMessageParts<OutboundMessage<"guess">, "prefix">(message, {prefix: 1}).prefix
                switch (mp) {
                    case "con":
                    case "dis":
                    case "ack":
                        key = `guess:${guessId as number}:${message as OutboundMessageTemplate<"guess", "con" | "dis" | "ack">}`
                        break
                    case "mes":
                        key = `guess:${guessId as number}:${getCutMessage<OutboundMessage<"guess", "mes">, "body">(message as OutboundMessageTemplate<"guess", "mes">, {body: 3}, 3)}`
                        break
                    default:
                        throw new Error("invalid message prefix")
                }
                /*const getConMessageAndKey: GetConMessageAndKey = () => {
                    const message: OutboundToGuessConMessage["template"] = `con:${payload as RedisMessagePayload<OutboundToGuessConMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToGuessConMessage]> = `guess:${guessId as number}:${message}`
                    return [message, key]
                }
                const getDisMessageAndKey: GetDisMessageAndKey = () => {
                    const message: OutboundToGuessDisMessage["template"] = `dis:${payload as RedisMessagePayload<OutboundToGuessDisMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToGuessDisMessage]> = `guess:${guessId as number}:${message}`
                    return [message, key]
                }
                const getMesMessageAndKey: GetMesMessageAndKey = () => {
                    const message: OutboundToGuessMesMessage["template"] = `mes:${payload as RedisMessagePayload<OutboundToGuessMesMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToGuessMesMessage]> = `guess:${guessId as number}:${getCutMessage<OutboundToGuessMesMessage, "body">(message, {body: 3}, 3)}`
                    return [message, key]
                }
                const getAckMessageAndKey: GetAckMessageAndKey = () => {
                    const message: OutboundToGuessAckMessage["template"] = `ack:${payload as RedisMessagePayload<OutboundToGuessAckMessage["template"]>}`
                    const key: RedisMessageKey<[OutboundToGuessAckMessage]> = `guess:${guessId as number}:${message}`
                    return [message, key]
                }*/
                sendMessage(key, message)
            }

            const sendMessage = (key: RedisMessageKey, message: OutboundMessageTemplate) => {
               /* let message : OutboundMessageTemplate
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
                }*/
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

            if (userType === "host") {
                publishMessage<OutboundToGuessConMessage>({number: date, prefix: "con"}, "guess", undefined)
                subscribeToMessages(sendMessageToHost, "host", undefined)
            } else {
                publishMessage<OutboundToHostConMessage>({number: date, prefix:"con", guessId: guessId as number}, "host", undefined)
                subscribeToMessages(sendMessageToGuess, "guess", guessId as number)
            }

            const handleMessage = <UT extends UserType>(wsMessage: ws.Message, handleMesMessage: HandleMesMessage<UT>, handleAckMessage: HandleAckMessage<UT>) => {
                const message = (wsMessage as IUtf8Message).utf8Data as InboundMessageTemplate<UT>
                const {prefix} = getMessageParts<InboundMessage, "prefix">(message, {prefix: 1})
                switch (prefix) {
                    case "mes":
                        // @ts-ignore: typescript does not realize that UT is the same type parameter in the function type and in the message
                        handleMesMessage(message as InboundMesMessage<UT>["template"])
                        break
                    case "ack":
                        // @ts-ignore: typescript does not realize that UT is the same type parameter in the function type and in the message
                        handleAckMessage(message as InboundAckMessage<UT>["template"])
                        break
                }
                console.log((new Date()) + " message: " + message)
            }
            const handleMessageFromHost = (m: ws.Message) => {
                const handleMesMessage: HandleMesMessage<"host"> = (m) => {
                    const {number, guessId: toGuessId, body} = getMessageParts<InboundFromHostMesMessage, "number" | "guessId" | "body">(m, {number: 2, guessId: 3, body: 4})
                    publishMessage<InboundMessageTarget<InboundFromHostMesMessage>>("mes", `${number}:${body}`, "guess", toGuessId)
                }
                const handleAckMessage: HandleAckMessage<"host"> = (a) => {
                    const {originPrefix, number, guessId} = getMessageParts<InboundFromHostAckMessage, "number" | "guessId" | "originPrefix">(a, {originPrefix: 2, number: 3, guessId: 4})
                    let messageOriginKey
                    switch (originPrefix) {

                    }
                    removeMessage(`host:${originPrefix}:${number}`)
                    if (originPrefix === "mes")
                    publishMessage<InboundMessageTarget<InboundFromHostAckMessage>>("ack", `${number}`, "guess", guessId)
                }
                handleMessage<"host">(m, handleMesMessage, handleAckMessage)
            }
            const handleMessageFromGuess = (m: ws.Message) => {
                const handleMesMessage: HandleMesMessage<"guess"> = (m) => {
                    const {number, body} = getMessageParts<InboundFromGuessMesMessage, "number" | "body">(m, {number: 2, body: 3})
                    publishMessage<InboundMessageTarget<InboundFromGuessMesMessage>>("mes", `${number}:${guessId as number}:${body}`, "host", undefined)
                }
                const handleAckMessage: HandleAckMessage<"guess"> = (a) => {
                    const {originPrefix, number} = getMessageParts<InboundFromGuessAckMessage, "originPrefix" | "number">(a, {originPrefix: 2, number: 3})
                    removeMessage<InboundMessageTarget<InboundFromGuessAckMessage>>(`host:ack:${number}`)
                    if (originPrefix === "mes")
                        publishMessage<InboundMessageTarget<InboundFromGuessAckMessage>>("ack", `${number}`, "host", undefined)
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
    const getConDisChannel = (isHostUser: boolean) => "con-dis" + "-" + (isHostUser ? suffixHost : suffixGuess)
    const getMessagesChannel = (isHostUser: boolean, guessId?: number) => "mes" + "-" + (isHostUser ? suffixHost : suffixGuess + "-" + guessId)

    const subscribeToMessages: SubscribeToMessages = async (sendMessage, ofUserType, guessId) => {
        const subscriber = redisClient.duplicate()
        await subscriber.connect()

        const isHostUser = ofUserType === "host"

        await subscriber.subscribe(getConDisChannel(isHostUser), (payload, channel) => {
            sendMessage("mes", payload)
        })
        await subscriber.subscribe(getMessagesChannel(isHostUser, guessId), (payload, channel) => {
            sendMessage("mes", payload)
        })
    }
    const publishMessage: PublishMessage = (parts, toUserType, toGuessId) => {
        let channel
        const isToHostUser = toUserType === "host"

        switch (parts.prefix) {
            case "con":
            case "dis":
                channel = getConDisChannel(isToHostUser)
                break
            case "mes":
            case "ack":
                channel = getMessagesChannel(isToHostUser, toGuessId)
                break
            default:
                throw new Error("should have been enter any case")
        }
        redisClient.publish(channel, getMessage(parts))
    }

    const cacheMessage: CacheMessage = (key, message) => { redisClient.set(key, message) }
    const removeMessage: RemoveMessage = (key) => { redisClient.del(key) }
    const isMessageAck: IsMessageAck = async (key) => await redisClient.get(key) === null

    initWebSocket(subscribeToMessages, publishMessage, cacheMessage, removeMessage, isMessageAck)
}

dotenv.config()
init()