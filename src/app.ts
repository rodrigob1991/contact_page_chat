import ws, {IUtf8Message} from "websocket"
import { createClient } from 'redis'
import http from "http"
import dotenv from "dotenv"
import { v4 as uuidv4 } from 'uuid'

type UserType = "host" | "guess"

type OutboundToHostMesMessage = `mes:${string}:${number}:${string}`
type OutboundToHostConMessage = `con:${string}:${number}`
type OutboundToHostDisMessage = `dis:${string}:${number}`
type OutboundToHostAckMessage = `ack:${number}`
type OutboundToGuessMesMessage = `mes:${number}:${string}`
type OutboundToGuessConMessage = `con:${number}`
type OutboundToGuessDisMessage = `dis:${number}`
type OutboundToGuessAckMessage = `ack:${number}`

type InboundFromHostMesMessage = `mes:${string}:${number}:${string}`
type InboundFromHostAckMessage = `ack:${number}`
type InboundFromGuessMesMessage = `mes:${number}:${string}`
type InboundFromGuessAckMessage = `ack:${number}`

//type HostGuess<T extends string> = T extends string ? `${T}-host` |  `${T}-guess` : never
type MessagePrefix = "con" | "dis" | "mes" | "ack"
type SendMessage = (mp: MessagePrefix, payload?: string) => void
type SubscribeToMessages = (sendMessage: SendMessage, userType: UserType, guessId?: string) => void
type PublishMessage = (mp: MessagePrefix, payload: string, userType: UserType, guessId?: string) => void

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

            const sendMessage: SendMessage = (mp, payload) => { connection.sendUTF() }

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

    const suffixHost = "host"
    const suffixGuess = "guess"
    const getConnectionsChannel = (userType: UserType) =>  "con" + "-" + (userType === "host" ? suffixHost : suffixGuess)
    const getDisconnectionsChannel = (userType: UserType) =>  "dis" + "-" + (userType === "host" ? suffixHost : suffixGuess)
    const getMessagesChannel = (userType: UserType, guessId?: string) => "mes" + "-" + (userType === "host" ? suffixHost : suffixGuess + "-" + guessId)
    const getAcknowledgmentChannel = (userType: UserType, guessId?: string) => "ack" + "-" + (userType === "host" ? suffixHost : suffixGuess + "-" + guessId)

    const subscribeToMessages: SubscribeToMessages = async (sendMessage, userType, guessId) => {
        const subscriber = redisClient.duplicate()
        await subscriber.connect()

        await subscriber.subscribe(getConnectionsChannel(userType), (message, channel) => {
            sendMessage("con", userType === "host" ? message : undefined)
        })
        await subscriber.subscribe(getDisconnectionsChannel(userType), (message, channel) => {
            sendMessage("dis", userType === "host" ? message : undefined)
        })
        await subscriber.subscribe(getMessagesChannel(userType, guessId), (message, channel) => {
            sendMessage("mes", message)
        })
        await subscriber.subscribe(getAcknowledgmentChannel(userType, guessId), (message, channel) => {
            sendMessage("ack", message)
        })
    }
    const publishMessage: PublishMessage = (mp, payload, userType, guessId) => {
        let channel
        switch (mp) {
            case "con":
                channel = getConnectionsChannel(userType)
                break
            case "dis":
                channel = getDisconnectionsChannel(userType)
                break
            case "mes":
                channel = getMessagesChannel(userType, guessId)
                break
            case "ack":
                channel = getAcknowledgmentChannel(userType, guessId)
                break
        }
        redisClient.publish(channel, payload)
    }

    initWebSocket(subscribeToMessages, publishMessage)
}

