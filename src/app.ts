import ws, {IUtf8Message} from "websocket"
import {createClient} from 'redis'
import http from "http"
import dotenv from "dotenv"
import {v4 as uuidv4} from 'uuid'

type UserType = "host" | "guess"

type OutboundToHostMesMessage = `mes:${number}:${string}:${string}`
type OutboundToHostConMessage = `con:${number}:${string}`
type OutboundToHostDisMessage = `dis:${number}:${string}`
type OutboundToHostAckMessage = `ack:${number}`
type OutboundToGuessMesMessage = `mes:${number}:${string}`
type OutboundToGuessConMessage = `con:${number}`
type OutboundToGuessDisMessage = `dis:${number}`
type OutboundToGuessAckMessage = `ack:${number}`

type OutboundMessage = OutboundToHostMesMessage | OutboundToHostConMessage | OutboundToHostDisMessage | OutboundToHostAckMessage
    | OutboundToGuessMesMessage | OutboundToGuessConMessage | OutboundToGuessDisMessage | OutboundToGuessAckMessage

type InboundFromHostMesMessage = `mes:${number}:${string}:${string}`
type InboundFromHostAckMessage = `ack:${number}`
type InboundFromGuessMesMessage = `mes:${number}:${string}`
type InboundFromGuessAckMessage = `ack:${number}`

type InboundMessage = InboundFromHostMesMessage | InboundFromHostAckMessage | InboundFromGuessMesMessage | InboundFromGuessAckMessage

//type HostGuess<T extends string> = T extends string ? `${T}-host` |  `${T}-guess` : never
type MessagePrefix = "con" | "dis" | "mes" | "ack"
type SendMessage = (mp: MessagePrefix, payload: string) => void
type SubscribeToMessages = (sendMessage: SendMessage, isHostUser: boolean, guessId?: string) => void
type PublishMessage = (mp: MessagePrefix, payload: string, toHostUser: boolean, guessId?: string) => void
type CacheMessage = (message: OutboundMessage, userType: UserType, guessId?: string) => void
type IsMessageAck = (mp: MessagePrefix, messageNumber: number, userType: UserType, guessId?: string) => boolean

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
                let message: OutboundMessage
                const isConnection = mp === "con"
                const isDisconnection = mp === "dis"
                const isMessage = mp === "mes"
                const isAcknowledge = mp === "ack"
                switch (true) {
                    case isConnection && isHostUser:
                        message = `con:${payload as `${number}:${string}`}`
                        break
                    case isConnection && !isHostUser:
                        message = `con:${payload as `${number}`}`
                        break
                    case isDisconnection && isHostUser:
                        message = `dis:${payload as `${number}:${string}`}`
                        break
                    case isDisconnection && !isHostUser:
                        message = `dis:${payload as `${number}`}`
                        break
                    case isMessage && isHostUser:
                        message = `mes:${payload as `${number}:${string}:${string}`}`
                        break
                    case isMessage && !isHostUser:
                        message = `mes:${payload as `${number}:${string}`}`
                        break
                    case isAcknowledge && isHostUser:
                        message = `ack:${payload as `${number}`}`
                        break
                    case isAcknowledge && !isHostUser:
                        message = `ack:${payload as `${number}`}`
                        break
                    default:
                        throw new Error("should had enter some case")
                }
                connection.sendUTF(message)

                cacheMessage(message, userType, guessId)

                const resendUntilAck = () => {
                    setTimeout(() => {
                        if (isMessageAck(guessId, nro)) {
                            resendUntilAck()
                        } else {
                            connection.sendUTF(message)
                        }
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

    const cacheMessage: CacheMessage = (message, userType, guessId) => {
        const key = message.substring(0, message.)
        redisClient.set("", message)

    }
    const isMessageAck: IsMessageAck = (mp, messageNumber, userType, guessId) => {


    }

    initWebSocket(subscribeToMessages, publishMessage, cacheMessage, isMessageAck)
}

