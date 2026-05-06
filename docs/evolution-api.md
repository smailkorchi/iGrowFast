# Evolution API v2.3.7 - Integration Documentation

## Overview

Evolution API is the WhatsApp integration layer. It runs on a Docker container on the VPS and handles WhatsApp Web connections via the Baileys protocol. Messages are forwarded to Supabase via webhooks.

**Official docs:** https://doc.evolution-api.com

## Architecture

```
WhatsApp <--> Evolution API (VPS:8083) --webhook--> Supabase Edge Function (evolution-webhook)
                                                         |
                                                         v
                                                   Supabase DB
                                                  (whatsapp_messages, whatsapp_contacts)
                                                         |
                                                         v
                                                   Frontend (WhatsAppInbox.tsx)
                                                         |
                                                    send message
                                                         |
                                                         v
                                              Supabase Edge Function (evolution-client)
                                                         |
                                                         v
                                              Evolution API (send-text/send-media)
```

## Authentication

All API requests require the `apikey` header:

```
Headers: { "apikey": "<EVOLUTION_API_KEY>" }
```

The key is stored as `EVOLUTION_API_KEY` in Supabase Edge Function secrets.

## Core API Endpoints

### Instance Management

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| POST   | `/instance/create`                        | Create a new WA instance       |
| GET    | `/instance/fetchInstances`                | List all instances             |
| DELETE | `/instance/delete/{instanceName}`         | Delete an instance             |
| GET    | `/instance/connect/{instanceName}`        | Get QR code for connection     |
| GET    | `/instance/connectionState/{instanceName}`| Check connection status        |

### Messaging

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| POST   | `/message/sendText/{instanceName}`        | Send text message              |
| POST   | `/message/sendMedia/{instanceName}`       | Send image/video/audio/doc     |
| POST   | `/message/sendWhatsAppAudio/{instanceName}`| Send audio as voice note      |

### Chat & Contact Data

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| POST   | `/chat/findChats/{instanceName}`          | List all chats (with last msg) |
| POST   | `/chat/findContacts/{instanceName}`       | List all contacts              |
| POST   | `/chat/findMessages/{instanceName}`       | Fetch messages with filters    |

### Settings

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| GET    | `/settings/find/{instanceName}`           | Get instance settings          |
| PUT    | `/settings/set/{instanceName}`            | Update instance settings       |

## Request/Response Formats

### Create Instance

```json
POST /instance/create
{
  "instanceName": "my-instance",
  "integration": "WHATSAPP-BAILEYS",
  "qrcode": true
}
```

### Send Text

```json
POST /message/sendText/{instanceName}
{
  "number": "212600000000",
  "options": {
    "delay": 1200,
    "presence": "composing",
    "linkPreview": false
  },
  "textMessage": {
    "text": "Hello world"
  }
}
```

### Send Media

```json
POST /message/sendMedia/{instanceName}
{
  "number": "212600000000",
  "options": {
    "delay": 1200,
    "presence": "composing"
  },
  "mediaMessage": {
    "mediatype": "image",
    "caption": "Check this out",
    "media": "https://example.com/image.jpg"
  }
}
```

Supported `mediatype` values: `image`, `video`, `audio`, `document`

### Find Chats Response Shape

```json
{
  "id": "cmnj1kbgd00jgnw4cmipvdnlw",
  "remoteJid": "2349699473535@lid",
  "pushName": "Contact Name",
  "profilePicUrl": "https://...",
  "updatedAt": "2026-04-03T15:25:40.000Z",
  "windowStart": "...",
  "windowExpires": "...",
  "windowActive": true,
  "lastMessage": {
    "id": "...",
    "key": {
      "id": "msg-id",
      "fromMe": true,
      "remoteJid": "...",
      "participant": ""
    },
    "pushName": "Sender",
    "messageType": "conversation",
    "message": { "conversation": "message text" },
    "messageTimestamp": 1775229940,
    "source": "ios",
    "status": "SERVER_ACK"
  },
  "unreadCount": 0,
  "isSaved": true
}
```

### Find Messages Request

```json
POST /chat/findMessages/{instanceName}
{
  "where": {
    "key": {
      "remoteJid": "2349699473535@lid"
    }
  },
  "limit": 20
}
```

### Find Messages Response Shape

```json
{
  "messages": {
    "total": 38,
    "pages": 1,
    "currentPage": 1,
    "records": [
      {
        "id": "...",
        "key": {
          "id": "msg-id",
          "fromMe": true/false,
          "remoteJid": "...",
          "participant": ""
        },
        "pushName": "Sender Name",
        "messageType": "conversation | audioMessage | imageMessage | videoMessage | documentMessage | reactionMessage",
        "message": {
          "conversation": "text content"
        },
        "messageTimestamp": 1775229940,
        "source": "ios | android | web",
        "contextInfo": null,
        "MessageUpdate": [{ "status": "DELIVERY_ACK | READ | SERVER_ACK" }]
      }
    ]
  }
}
```

## Webhook Events

The Evolution API sends webhooks to the global URL for these enabled events:

| Event                   | Enabled | Description                          |
| ----------------------- | ------- | ------------------------------------ |
| QRCODE_UPDATED          | Yes     | QR code generated/refreshed          |
| MESSAGES_UPSERT         | Yes     | New message received/sent            |
| MESSAGES_UPDATE         | Yes     | Message status update (read/delivered)|
| CONNECTION_UPDATE       | Yes     | Instance connected/disconnected      |

### Webhook Payload (MESSAGES_UPSERT)

```json
{
  "event": "messages.upsert",
  "instance": "ghita",
  "data": {
    "key": {
      "remoteJid": "212600000000@s.whatsapp.net",
      "fromMe": false,
      "id": "MESSAGE_ID"
    },
    "pushName": "Contact Name",
    "message": {
      "conversation": "message text"
    },
    "messageType": "conversation",
    "messageTimestamp": 1775229940
  }
}
```

## Supabase Tables

### whatsapp_contacts

| Column       | Type         | Description              |
| ------------ | ------------ | ------------------------ |
| id           | uuid         | Primary key              |
| business_id  | uuid         | FK to businesses         |
| phone_number | text         | WhatsApp number          |
| name         | text         | Contact display name     |
| profile_pic  | text         | Profile picture URL      |
| created_at   | timestamptz  | Record creation time     |
| updated_at   | timestamptz  | Last update time         |

### whatsapp_messages

| Column       | Type         | Description                    |
| ------------ | ------------ | ------------------------------ |
| id           | uuid         | Primary key                    |
| business_id  | uuid         | FK to businesses               |
| instance_id  | uuid         | FK to whatsapp_instances       |
| contact_id   | uuid         | FK to whatsapp_contacts        |
| remote_jid   | text         | WhatsApp JID                   |
| message_id   | text         | Evolution message ID           |
| type         | text         | Message type (conversation, audioMessage, etc.) |
| content      | text         | Text content                   |
| media_url    | text         | Media URL if applicable        |
| direction    | text         | "incoming" or "outgoing"       |
| status       | text         | sent / delivered / read        |
| created_at   | timestamptz  | Message timestamp              |

### whatsapp_instances

Managed via the WhatsApp Manager page. Stores instance_name, business_id, connection status.

## Edge Functions

### evolution-client

Proxies requests from the frontend to Evolution API. Actions:
- `create-instance` - Create new WhatsApp instance
- `get-qr` - Get QR code for pairing
- `delete-instance` - Remove instance
- `send-text` - Send text message
- `send-media` - Send media message

### evolution-webhook

Receives webhook events from Evolution API and:
1. Upserts contacts into `whatsapp_contacts`
2. Inserts messages into `whatsapp_messages`
3. Updates message status on `MESSAGES_UPDATE` events
4. Updates instance connection status on `CONNECTION_UPDATE` events

## Message Types Reference

| messageType         | Content field in `message` object         |
| ------------------- | ----------------------------------------- |
| conversation        | `message.conversation`                    |
| extendedTextMessage | `message.extendedTextMessage.text`        |
| imageMessage        | `message.imageMessage.url` + `.caption`   |
| videoMessage        | `message.videoMessage.url` + `.caption`   |
| audioMessage        | `message.audioMessage.url` (ptt = voice)  |
| documentMessage     | `message.documentMessage.url`             |
| reactionMessage     | `message.reactionMessage.text` (emoji)    |
| stickerMessage      | `message.stickerMessage.url`              |

## JID Formats

- Individual: `212600000000@s.whatsapp.net` or `number@lid` (new format)
- Group: `120363405239176149@g.us`
- `key.fromMe` = true means outgoing, false means incoming
