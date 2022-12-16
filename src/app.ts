import ws, {IUtf8Message} from "websocket"
import { createClient } from 'redis'
import http from "http"
import dotenv from "dotenv"
import { v4 as uuidv4 } from 'uuid'

type OutboundMessageType = "con" | "dis" | "mes" | "ak"
type InboundMessageType = "mes" | "ak"
type OutboundHostMessage<T extends OutboundMessageType> = `${T}:${string}${T extends ("con" | "dis") ? "" : `:${number}:${string}`}`
type InboundHostMessage<T extends InboundMessageType> = `${T}:${string}:${number}`
type OutboundGuessMessage<T extends OutboundMessageType> = `${T}:${number}${T extends "mes" ? `:${string}` : ""}`
type InboundGuessMessage<T extends InboundMessageType> = `${T}:${number}${T extends "mes" ? `:${string}` : ""}`
type OutboundMessage<T extends OutboundMessageType> = OutboundHostMessage<T> | OutboundGuessMessage<T>
type SendMessage<O extends OutboundMessage<OutboundMessageType>> = <T extends OutboundMessageType>(t: T, m: string) => void
type SubscribeToMessages = (sendMessage: SendMessage, isHost: boolean,  guessId?: string) => void
type PublishMessage = <H extends boolean, MT extends MessageType>(messageType: MT, m: MT extends "mes" ? string : "", isHost: H,  guessId: H extends true ? undefined : string) => void

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
const initWebSocket = (subscribeToMessages : SubscribeToMessages, publishMessage: PublishMessage) => {
    const wsServer = new ws.server({
        httpServer: initHttpServer(),
        autoAcceptConnections: false
    })

    const originIsAllowed = (origin: string) => {
        return true
    }
    wsServer.on("request", (request) => {
        const origin = request.origin
        if (!originIsAllowed(origin)) {
            request.reject()
            console.log(`${new Date()} connection from origin ${origin} rejected.`)
        } else {
            const connection = request.accept("echo-protocol", origin)
            console.log((new Date()) + " connection accepted")

            const sendMessage: SendMessage = (m) => { connection.sendUTF(m) }

            const isHostUser = request.httpRequest.headers.host_user === process.env.HOST_USER_SECRET
            const guessId = isHostUser ? undefined : uuidv4()

            subscribeToMessages(sendMessage, isHostUser, guessId)
            publishMessage("con", "", isHostUser, guessId)

            connection.on("message", (m) => {
                publishMessage("mes", (m as IUtf8Message).utf8Data, isHostUser, guessId)
                console.log((new Date()) + " message: " + m)
            })
            connection.on("close", (reasonCode, description) => {
                publishMessage("dis", "", isHostUser, guessId)
                console.log((new Date()) + " peer " + connection.remoteAddress + " disconnected.")
            })
        }
    })
}

const init = async () => {
    const redisClient = await initRedisConnection()

    const connectionsChannelPrefix = "connections"
    const disconnectionsChannelPrefix = "disconnections"
    const messagesChannelPrefix = "messages"
    const suffixHost = "host"
    const suffixGuess = "guess"
    const getConnectionsChannel = (isHost: boolean) =>  connectionsChannelPrefix + "-" + (isHost ? suffixHost : suffixGuess)
    const getDisconnectionsChannel = (isHost: boolean) =>  disconnectionsChannelPrefix + "-" + (isHost ? suffixHost : suffixGuess)
    const getMessagesChannel = (isHost: boolean, guessId?: string) => messagesChannelPrefix + "-" + (isHost ? suffixHost : suffixGuess + "-" + guessId)

    const subscribeToMessages: SubscribeToMessages = async (sendMessage, isHost, guessId) => {
        const subscriber = redisClient.duplicate()
        await subscriber.connect()

        await subscriber.subscribe(getConnectionsChannel(isHost), (message, channel) => {
            sendMessage("con")
        })
        await subscriber.subscribe(getDisconnectionsChannel(isHost), (message, channel) => {
            sendMessage("dis")
        })
        await subscriber.subscribe(getMessagesChannel(isHost, guessId), (message, channel) => {
            sendMessage(("mes-" + message) as `mes-${string}`)
        })
    }
    const publishMessage: PublishMessage = (type, m, isHost, guessId) => {
        const channel = type === "con" ? getConnectionsChannel(isHost) : type === "dis" ? getDisconnectionsChannel(isHost) : getMessagesChannel(isHost, guessId)
        redisClient.publish(channel, isHost ? m : "from{" + guessId + "}" + m)
    }

    initWebSocket(subscribeToMessages, publishMessage)
}

