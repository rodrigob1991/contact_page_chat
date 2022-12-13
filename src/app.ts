import ws from "websocket"
import { createClient } from 'redis'
import http from "http"
import dotenv from "dotenv"
import { v4 as uuidv4 } from 'uuid'

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
const initWebSocketServer = (subscribeToMessages : SubscribeToMessages, publishMessage: PublishMessage) => {
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

            const sendMessage = (message: string) => { connection.sendUTF(message) }
            const isHostUser = request.httpRequest.headers.host_user === process.env.HOST_USER_SECRET
            const guessId = isHostUser ? undefined : uuidv4()
            subscribeToMessages(sendMessage, isHostUser, guessId)

            connection.on("message", (message) => {
                if(isHostUser){

                }
            })
            connection.on('close', function (reasonCode, description) {
                console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.')
            })
        }
    })
}

type SubscribeToMessages = (sendMessage: (m: string) => void, isHost: boolean,  guessId?: string) => void
type PublishMessage = (type: "message" | "connection", m: string, isHost: boolean,  guessId?: string) => void

const init = async () => {
    const redisClient = await initRedisConnection()

    const connectionsChannelPrefix = "connections"
    const messagesChannelPrefix = "messages"
    const suffixHost = "host"
    const suffixGuess = "guess"
    const getConnectionsChannel = (isHost: boolean) =>  connectionsChannelPrefix + "-" + (isHost ? suffixHost : suffixGuess)
    const getMessagesChannel = (isHost: boolean, guessId?: string) => messagesChannelPrefix + "-" + (isHost ? suffixHost : suffixGuess + "-" + guessId)

    const subscribeToMessages: SubscribeToMessages = async (sendMessage, isHost, guessId) => {
        const subscriber = redisClient.duplicate()
        await subscriber.connect()

        await subscriber.subscribe(getConnectionsChannel(isHost), (message, channel) => {
            sendMessage(message)
        })
        await subscriber.subscribe(getMessagesChannel(isHost, guessId), (message, channel) => {
            sendMessage(message)
        })
    }
    const publishMessage: PublishMessage = (type, m, isHost, guessId) => {
        const channel = type === "connection" ? getConnectionsChannel(isHost) : getMessagesChannel(isHost, guessId)
        redisClient.publish(channel, m)
    }
}



