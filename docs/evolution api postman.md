Evolution API | v2.3.* Documentation
﻿

Authorization
API Key
Key
apikey
Value
globalApikey (Get information from the ENV file)
Instance
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Instance
https://sub.domain.com (Domain of your API)/instance/create
﻿

Authorization
API Key
Key
apikey
Value
globalApikey (Get information from the ENV file)
Body
raw (json)
View More
json
{
    // instance
    "instanceName": "instance (Instance name)",
    // "token": "apikey (Enter or leave empty to create dynamically)", // (Optional)
    // "number": "559999999999 (Recipient number with Country Code)", // (Optional)
    "qrcode": true, // (Optional)
    "integration": "WHATSAPP-BAILEYS" // WHATSAPP-BAILEYS | WHATSAPP-BUSINESS | EVOLUTION (Default WHATSAPP-BAILEYS) 
    // settings (Optional)
    // "rejectCall": false,
    // "msgCall": "",
    // "groupsIgnore": false,
    // "alwaysOnline": false,
    // "readMessages": false,
    // "readStatus": false,
    // "syncFullHistory": false,
    // // proxy (Optional)
    // "proxyHost": "",
    // "proxyPort": "",
    // "proxyProtocol": "",
    // "proxyUsername": "",
    // "proxyPassword": "",
    // webhook (Optional)
    // "webhook": {
    //     "url": "",
    //     "byEvents": false,
    //     "base64": true,
    //     "headers": {
    //         "autorization": "Bearer TOKEN",
    //         "Content-Type": "application/json"
    //     },
    //     "events": [
    //         "APPLICATION_STARTUP",
    //         "QRCODE_UPDATED",
    //         "MESSAGES_SET",
    //         "MESSAGES_UPSERT",
    //         "MESSAGES_UPDATE",
    //         "MESSAGES_DELETE",
    //         "SEND_MESSAGE",
    //         "CONTACTS_SET",
    //         "CONTACTS_UPSERT",
    //         "CONTACTS_UPDATE",
    //         "PRESENCE_UPDATE",
    //         "CHATS_SET",
    //         "CHATS_UPSERT",
    //         "CHATS_UPDATE",
    //         "CHATS_DELETE",
    //         "GROUPS_UPSERT",
    //         "GROUP_UPDATE",
    //         "GROUP_PARTICIPANTS_UPDATE",
    //         "CONNECTION_UPDATE",
    //         "LABELS_EDIT",
    //         "LABELS_ASSOCIATION",
    //         "CALL",
    //         "TYPEBOT_START",
    //         "TYPEBOT_CHANGE_STATUS"
    //     ]
    // },
    // // rabbitmq (Optional)
    // "rabbitmq": {
    //     "enabled": true,
    //     "events": [
    //         "APPLICATION_STARTUP",
    //         "QRCODE_UPDATED",
    //         "MESSAGES_SET",
    //         "MESSAGES_UPSERT",
    //         "MESSAGES_UPDATE",
    //         "MESSAGES_DELETE",
    //         "SEND_MESSAGE",
    //         "CONTACTS_SET",
    //         "CONTACTS_UPSERT",
    //         "CONTACTS_UPDATE",
    //         "PRESENCE_UPDATE",
    //         "CHATS_SET",
    //         "CHATS_UPSERT",
    //         "CHATS_UPDATE",
    //         "CHATS_DELETE",
    //         "GROUPS_UPSERT",
    //         "GROUP_UPDATE",
    //         "GROUP_PARTICIPANTS_UPDATE",
    //         "CONNECTION_UPDATE",
    //         "LABELS_EDIT",
    //         "LABELS_ASSOCIATION",
    //         "CALL",
    //         "TYPEBOT_START",
    //         "TYPEBOT_CHANGE_STATUS"
    //     ]
    // },
    // // sqs (Optional)
    // "sqs": {
    //     "enabled": true,
    //     "events": [
    //         "APPLICATION_STARTUP",
    //         "QRCODE_UPDATED",
    //         "MESSAGES_SET",
    //         "MESSAGES_UPSERT",
    //         "MESSAGES_UPDATE",
    //         "MESSAGES_DELETE",
    //         "SEND_MESSAGE",
    //         "CONTACTS_SET",
    //         "CONTACTS_UPSERT",
    //         "CONTACTS_UPDATE",
    //         "PRESENCE_UPDATE",
    //         "CHATS_SET",
    //         "CHATS_UPSERT",
    //         "CHATS_UPDATE",
    //         "CHATS_DELETE",
    //         "GROUPS_UPSERT",
    //         "GROUP_UPDATE",
    //         "GROUP_PARTICIPANTS_UPDATE",
    //         "CONNECTION_UPDATE",
    //         "LABELS_EDIT",
    //         "LABELS_ASSOCIATION",
    //         "CALL",
    //         "TYPEBOT_START",
    //         "TYPEBOT_CHANGE_STATUS"
    //     ]
    // },
    // // chatwoot (Optional)
    // "chatwootAccountId": "1",
    // "chatwootToken": "TOKEN",
    // "chatwootUrl": "https://chatoot.com",
    // "chatwootSignMsg": true,
    // "chatwootReopenConversation": true,
    // "chatwootConversationPending": false,
    // "chatwootImportContacts": true,
    // "chatwootNameInbox": "evolution",
    // "chatwootMergeBrazilContacts": true,
    // "chatwootImportMessages": true,
    // "chatwootDaysLimitImportMessages": 3,
    // "chatwootOrganization": "Evolution Bot",
    // "chatwootLogo": "https://evolution-api.com/files/evolution-api-favicon.png",
}
GET
Fetch Instances
https://sub.domain.com (Domain of your API)/instance/fetchInstances
﻿

Authorization
API Key
Key
apikey
Value
apikey (Enter or leave empty to create dynamically)
Query Params
instanceName
instance (Instance name)
instanceId
INSTANCE_ID
GET
Instance Connect
https://sub.domain.com (Domain of your API)/instance/connect/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
number
559999999999 (Recipient number with Country Code)
POST
Restart Instance
https://sub.domain.com (Domain of your API)/instance/restart/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Presence
https://sub.domain.com (Domain of your API)/instance/setPresence/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "presence": "available" /* available, unavailable */
}
GET
Connection Status
https://sub.domain.com (Domain of your API)/instance/connectionState/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
DELETE
Logout Instance
https://sub.domain.com (Domain of your API)/instance/logout/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
DELETE
Delete Instance
https://sub.domain.com (Domain of your API)/instance/delete/instance (Instance name)
﻿

Authorization
API Key
Key
apikey
Value
globalApikey (Get information from the ENV file)
Proxy
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Proxy
https://sub.domain.com (Domain of your API)/proxy/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "enabled": true,
    "host": "0.0.0.0",
    "port": "8000",
    "protocol": "http",
    "username": "user",
    "password": "pass"
}
GET
Find Proxy
https://sub.domain.com (Domain of your API)/proxy/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Settings
https://sub.domain.com (Domain of your API)/settings/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
	"rejectCall": true,
    "msgCall": "I do not accept calls",
    "groupsIgnore": false,
    "alwaysOnline": true,
    "readMessages": false,
    "syncFullHistory": false,
    "readStatus": false
}
GET
Find Settings
https://sub.domain.com (Domain of your API)/settings/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Send Message
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Send Text
https://sub.domain.com (Domain of your API)/message/sendText/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "text": "teste de envio"
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "linkPreview": false,
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send Media URL
https://sub.domain.com (Domain of your API)/message/sendMedia/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "mediatype": "image", // image, video or document
    "mimetype": "image/png",
    "caption": "Teste de caption",
    "media": "https://s3.amazonaws.com/atendai/company-3708fcdf-954b-48f8-91ff-25babaccac67/1712605171932.jpeg", /* url or base64 */
    "fileName": "Imagem.png"
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send Media File
https://sub.domain.com (Domain of your API)/message/sendMedia/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Send PTV
https://sub.domain.com (Domain of your API)/message/sendPtv/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "video": "https://evolution-api.com/files/video.mp4", /* url or base64 */
    // options
    "delay": 1200
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send PTV File
https://sub.domain.com (Domain of your API)/message/sendPtv/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
form-data
number
559999999999 (Recipient number with Country Code)
file
POST
Send Narrated Audio
https://sub.domain.com (Domain of your API)/message/sendWhatsAppAudio/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "audio": "https://evolution-api.com/files/narratedaudio.mp3" /* url or base64 */
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ],
    // "encoding": true
}
POST
Send Status/Stories
https://sub.domain.com (Domain of your API)/message/sendStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "type": "text", /* text, image, video, audio */
    "content": "Hi, how are you today?", /* text or url */
    "caption": "This is my status/storie image", /* Optional for image or video */
    "backgroundColor": "#008000",
    "font": 1, /* Optional for text only. Accept the options below:
                      1 = SERIF
                      2 = NORICAN_REGULAR
                      3 = BRYNDAN_WRITE
                      4 = BEBASNEUE_REGULAR
                      5 = OSWALD_HEAVY */
    "allContacts": false, /* true to send to all contacts or false to send to statusJidList below */
    "statusJidList": [
        "559999999999 (Recipient number with Country Code)@s.whatsapp.net"
    ]
}
POST
Send Sticker
https://sub.domain.com (Domain of your API)/message/sendSticker/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "sticker": "https://evolution-api.com/files/sticker.png" /* url or base64 */
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send Location
https://sub.domain.com (Domain of your API)/message/sendLocation/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "name": "Bora Bora",
    "address": "French Polynesian",
    "latitude": -16.505538233564373,
    "longitude": -151.7422770494996
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send Contact
https://sub.domain.com (Domain of your API)/message/sendContact/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "contact": [
        {
            "fullName": "Contact Name",
            "wuid": "559999999999",
            "phoneNumber": "+55 99 9 9999-9999",
            "organization": "Company Name", /* Optional */
            "email": "email", /* Optional */
            "url": "url page" /* Optional */
        },
        {
            "fullName": "Contact Name",
            "wuid": "559911111111",
            "phoneNumber": "+55 99 9 1111-1111",
            "organization": "Company Name", /* Optional */
            "email": "email", /* Optional */
            "url": "url page" /* Optional */
        }
    ]
}
POST
Send Reaction
https://sub.domain.com (Domain of your API)/message/sendReaction/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    // key of the message or key.id only for get message in database
    "key": {
        "remoteJid": "559999999999 (Recipient number with Country Code)@s.whatsapp.net", // or 999999999999999999@g.us (Group Number)@g.us"
        "fromMe": true,
        "id": "BAE5A75CB0F39712"
    },
    "reaction": "🚀"
}
POST
Send Poll
https://sub.domain.com (Domain of your API)/message/sendPoll/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "name": "Main text of the poll",
    "selectableCount": 1,
    "values": [
        "Question 1",
        "Question 2",
        "Question 3"
    ]
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send List
https://sub.domain.com (Domain of your API)/message/sendList/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "title": "List Title",
    "description": "List description",
    "buttonText": "Click Here",
    "footerText": "footer list\nhttps://examplelink.com.br",
    "sections": [
        {
            "title": "Row tilte 01",
            "rows": [
                {
                    "title": "Title row 01",
                    "description": "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s,",
                    "rowId": "rowId 001"
                },
                {
                    "title": "Title row 02",
                    "description": "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s,",
                    "rowId": "rowId 002"
                }
            ]
        },
        {
            "title": "Row tilte 02",
            "rows": [
                {
                    "title": "Title row 01",
                    "description": "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s,",
                    "rowId": "rowId 001"
                },
                {
                    "title": "Title row 02",
                    "description": "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s,",
                    "rowId": "rowId 002"
                }
            ]
        }
    ]
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
POST
Send Button
https://sub.domain.com (Domain of your API)/message/sendButtons/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "title": "Title Button",
    "description": "Description Button",
    "footer": "Footer Button",
    "buttons": [
        {
            "type": "reply",
            "displayText": "Resposta",
            "id": "123"
        }
        // {
        //     "type": "copy",
        //     "displayText": "Copia Código",
        //     "copyCode": "ZXN0ZSDDqSB1bSBjw7NkaWdvIGRlIHRleHRvIGNvcGnDoXZlbC4="
        // },
        // {
        //     "type": "url",
        //     "displayText": "Evolution API",
        //     "url": "http://evolution-api.com"
        // },
        // {
        //     "type": "call",
        //     "displayText": "Me ligue",
        //     "phoneNumber": "557499879409"
        // }
        // {
        //     "type": "pix",
        //     "currency": "BRL",
        //     "name": "Davidson Gomes",
        //     "keyType": "random", /* phone, email, cpf, cnpj, random  */
        //     "key": "0ea59ac5-f001-4f0e-9785-c772200f1b1e"
        // }
    ]
    // options
    // "delay": 1200,
    // "quoted": {
    //     // payload message or key.id only for get message in database
    //     "key": {
    //         "id": " MESSAGE_ID"
    //     },
    //     "message": {
    //         "conversation": "CONTENT_MESSAGE"
    //     }
    // },
    // "mentionsEveryOne": false,
    // "mentioned": [
    //     "559999999999 (Recipient number with Country Code)"
    // ]
}
Call
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Fake Call
https://sub.domain.com (Domain of your API)/call/offer/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "isVideo": false,
    "callDuration": 3
}
Chat
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Check is WhatsApp Number
https://sub.domain.com (Domain of your API)/chat/whatsappNumbers/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "numbers": [
    "55911111111",
    "55922222222",
    "55933333333",
    "55944444444",
    "55955555555"
  ]
}
POST
Read Messages
https://sub.domain.com (Domain of your API)/chat/markMessageAsRead/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "readMessages": [
    {
      "remoteJid": "123@s.whatsapp.net",
      "fromMe": false,
      "id": "80C4CE9B72F797DBC6ECD8D19B247FC9"
    }
  ]
}
POST
Archive Chat
https://sub.domain.com (Domain of your API)/chat/archiveChat/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "lastMessage": {
        "key": {
            "remoteJid": "123@s.whatsapp.net",
            "fromMe": false,
            "id": "80C4CE9B72F797DBC6ECD8D19B247FC9"
        }
    },
    "chat": "123@s.whatsapp.net",
    // false: to unarchive
    // true: to archive
    "archive": false
}
POST
Mark Chat Unread
https://sub.domain.com (Domain of your API)/chat/markChatUnread/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "lastMessage": {
        "key": {
            "remoteJid": "123@s.whatsapp.net",
            "fromMe": false,
            "id": "80C4CE9B72F797DBC6ECD8D19B247FC9"
        }
    },
    "chat": "123@s.whatsapp.net"
}
DELETE
Delete Message
https://sub.domain.com (Domain of your API)/chat/deleteMessageForEveryone/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "id": "id",
  "remoteJid": "remoteJid",
  "fromMe": true,
  // optional
  "participant": "paticipant"
}
POST
Fetch Profile Picture
https://sub.domain.com (Domain of your API)/chat/fetchProfilePictureUrl/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "number": "559999999999 (Recipient number with Country Code)"
}
POST
Get Base64 From Media Message
https://sub.domain.com (Domain of your API)/chat/getBase64FromMediaMessage/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
/*
  In this endpoint it is possible to extract the Base64 of the media 
  received in the messages, passing the message ID as a parameter.
  Make sure that the received message is stored in MongoDB or in a file,
  otherwise the error 400 - Bad Request will be displayed.
  If the media type is audio, the mimetype audio/ogg is returned by default. 
  If you need an MP4 file, check the "convertToMp4" option as "true"
*/
{
    // payload message or key.id only for get message in database
    "message": {
        "key": {
            "id": "3EB0F4A1F841F02958FB74"
        }
    },
    "convertToMp4": false
}
POST
Update Message
https://sub.domain.com (Domain of your API)/chat/updateMessage/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "key":  {
        "remoteJid": "123@s.whatsapp.net",
        "fromMe": true,
        "id": "3EB04DC69D97835D7CC6F12776D25766FBC224E2"
    },
    "text": "new message"
}
POST
Send Presence
https://sub.domain.com (Domain of your API)/chat/sendPresence/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "delay": 1200,
    "presence": "composing"
}
POST
Update Block Status
https://sub.domain.com (Domain of your API)/message/updateBlockStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "status": "block" /* block, unblock */
}
POST
Find Contacts
https://sub.domain.com (Domain of your API)/chat/findContacts/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
/*
  Here it is possible to list all contacts or just one,
  using the 'where' option.
*/
{
  "where": {
//    "id": "559999999999 (Recipient number with Country Code)" /* Optional */
  }
}
POST
Find Messages
https://sub.domain.com (Domain of your API)/chat/findMessages/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
/*
  Each of these properties are optional.
  With mongodb disabled, only the "key.id" property is available.
  Remove all comments before submitting the request.
*/
{
    "where": {
        "key": {
            "remoteJid": "559999999999 (Recipient number with Country Code)"
        }
    },
    // optional
    "page": 1,
    "offset": 10
}
POST
Find Status Message
https://sub.domain.com (Domain of your API)/chat/findStatusMessage/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
/*
  Each of these properties are optional.
  With mongodb disabled, only the "id" property is available.
  Remove all comments before submitting the request.
*/
{
  "where": {
    "remoteJid": "123@s.whatsapp.net",
    "id": "BAE5959535174C7E"
  },
  // optional
  "page": 1,
  "offset": 10
}
POST
Find Chats
https://sub.domain.com (Domain of your API)/chat/findChats/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Label
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
GET
Find Labels
https://sub.domain.com (Domain of your API)/label/findLabels/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Handle Labels
https://sub.domain.com (Domain of your API)/label/handleLabel/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "labelId": "labelId",
    "action": "add" /* add or remove */
}
Profile Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Fetch Business Profile
https://sub.domain.com (Domain of your API)/chat/fetchBusinessProfile/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "number": "559999999999 (Recipient number with Country Code)"
}
POST
Fetch Profile
https://sub.domain.com (Domain of your API)/chat/fetchProfile/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "number": "559999999999 (Recipient number with Country Code)"
}
POST
Update Profile Name
https://sub.domain.com (Domain of your API)/chat/updateProfileName/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "name": "Evolution-API"
}
POST
Update Profile Status
https://sub.domain.com (Domain of your API)/chat/updateProfileStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "status": "Unavailable for calls"
}
POST
Update Profile Picture
https://sub.domain.com (Domain of your API)/chat/updateProfilePicture/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "picture": "https://avatars.githubusercontent.com/u/136080052?s=200&v=4"
}
DELETE
Remove Profile Picture
https://sub.domain.com (Domain of your API)/chat/removeProfilePicture/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch Privacy Settings
https://sub.domain.com (Domain of your API)/chat/fetchPrivacySettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Update Privacy Settings
https://sub.domain.com (Domain of your API)/chat/updatePrivacySettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "readreceipts": "all", /*'all', 'none'*/
    "profile": "all", /*'all', 'contacts', 'contact_blacklist', 'none'*/
    "status": "contacts", /*'all', 'contacts', 'contact_blacklist', 'none'*/
    "online": "all", /*'all', 'match_last_seen'*/
    "last": "contacts", /*'all', 'contacts', 'contact_blacklist', 'none'*/
    "groupadd": "none" /*'all', 'contacts', 'contact_blacklist'*/
}
Group
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Group
https://sub.domain.com (Domain of your API)/group/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "subject": "Test 02",  
  "description": "optional",
  "participants": [
    "5531900000000",
    "5531900000000"
  ]
}
POST
Update Group Picture
https://sub.domain.com (Domain of your API)/group/updateGroupPicture/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Body
raw (json)
json
{
  "image": "https://evolution-api.com/files/sticker.png"
}
POST
Update Group Subject
https://sub.domain.com (Domain of your API)/group/updateGroupSubject/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Body
raw (json)
json
{
  "subject": "Group Name or Subject"
}
POST
Update Group Description
https://sub.domain.com (Domain of your API)/group/updateGroupDescription/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Body
raw (json)
json
{
  "description": "Group Description or Rules"
}
GET
Fetch Invite Code
https://sub.domain.com (Domain of your API)/group/inviteCode/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
POST
Revoke Invite Code
https://sub.domain.com (Domain of your API)/group/revokeInviteCode/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
POST
Send Invite Url
https://sub.domain.com (Domain of your API)/group/sendInvite/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
  "groupJid": "999999999999999999@g.us (Group Number)",
  "description": "Access this link to join my WhatsApp group:",
  "numbers": [
    "559999999999 (Recipient number with Country Code)"
  ]
}
GET
Find Group by Invite Code
https://sub.domain.com (Domain of your API)/group/inviteInfo/instance (Instance name)?inviteCode=inviteCode (Group Invite Code)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
inviteCode
inviteCode (Group Invite Code)
GET
Find Group by Jid
https://sub.domain.com (Domain of your API)/group/findGroupInfos/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
GET
Fetch All Groups
https://sub.domain.com (Domain of your API)/group/fetchAllGroups/instance (Instance name)?getParticipants=false
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
getParticipants
false
GET
Find Participants
https://sub.domain.com (Domain of your API)/group/participants/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
POST
Update Participant
https://sub.domain.com (Domain of your API)/group/updateParticipant/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Body
raw (json)
json
{
  "action": "add", // add = Add new member on group
                   // remove = Remove existing member on group
                   // promote = Promote to group admin
                   // demote = Demote to group user
  "participants": [
    "5531900000000",
    "5531911111111",
    "5531922222222"
  ]
}
POST
Update Setting
https://sub.domain.com (Domain of your API)/group/updateSetting/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Body
raw (json)
View More
json
{
  "action": "not_announcement" // announcement = Only Admins send messages
                               // not_announcement = All Members send messages
                               // locked = Only Admins edit group settings
                               // unlocked = All Members edit group settings
}
POST
Toggle Ephemeral
https://sub.domain.com (Domain of your API)/group/toggleEphemeral/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Body
raw (json)
json
{
  "expiration": 0 // 0 = Off 
                  // 86400 = 24 Hours 
                  // 604800 = 7 Days 
                  // 7776000 = 90 Days
}
DELETE
Leave Group
https://sub.domain.com (Domain of your API)/group/leaveGroup/instance (Instance name)?groupJid=999999999999999999@g.us (Group Number)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Query Params
groupJid
999999999999999999@g.us (Group Number)
Integrations
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Events
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Websocket
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Websocket
https://sub.domain.com (Domain of your API)/websocket/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "websocket": {
        "enabled": true,
        "events": [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS"
        ]
    }
}
GET
Find Websocket
https://sub.domain.com (Domain of your API)/websocket/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Rabbitmq
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Rabbitmq
https://sub.domain.com (Domain of your API)/rabbitmq/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "rabbitmq": {
        "enabled": true,
        "events": [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS"
        ]
    }
}
GET
Find Rabbitmq
https://sub.domain.com (Domain of your API)/rabbitmq/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Sqs
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Sqs
https://sub.domain.com (Domain of your API)/sqs/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "sqs": {
        "enabled": true,
        "events": [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS"
        ]
    }
}
GET
Find Sqs
https://sub.domain.com (Domain of your API)/sqs/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Nats
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Nats
https://sub.domain.com (Domain of your API)/nats/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "sqs": {
        "enabled": true,
        "events": [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS"
        ]
    }
}
GET
Find Nats
https://sub.domain.com (Domain of your API)/nats/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Pusher
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Pusher
https://sub.domain.com (Domain of your API)/pusher/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "sqs": {
        "enabled": true,
        "events": [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS"
        ]
    }
}
GET
Find Pusher
https://sub.domain.com (Domain of your API)/pusher/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Webhook
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Webhook
https://sub.domain.com (Domain of your API)/webhook/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "webhook": {
        "enabled": true,
        "url": "https://webhook.site",
        "headers": {
            "autorization": "Bearer TOKEN",
            "Content-Type": "application/json"
        },
        "byEvents": false,
        "base64": false,
        "events": [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS"
        ]
    }
}
GET
Find Webhook
https://sub.domain.com (Domain of your API)/webhook/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Chatbot
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Chatwoot
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Chatwoot
https://sub.domain.com (Domain of your API)/chatwoot/set/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
	"enabled": true,
	"accountId": "1",
    "token": "TOKEN",
    "url": "https://chatwoot.com",
    "signMsg": true,
    "reopenConversation": true,
    "conversationPending": false,
    "nameInbox": "evolution",
    "mergeBrazilContacts": true,
    "importContacts": true,
    "importMessages": true,
    "daysLimitImportMessages": 2,
    "signDelimiter": "\n",
    "autoCreate": true,
    "organization": "BOT",
    "logo": "link da sua",
    "ignoreJids": [
        "@g.us"
    ]
}
GET
Find Chatwoot
https://sub.domain.com (Domain of your API)/chatwoot/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Typebot
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Typebot Session
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Change Session Status
https://sub.domain.com (Domain of your API)/typebot/changeStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "remoteJid": "5511912345678@s.whatsapp.net",
    "status": "closed" /* opened, paused, closed */
}
GET
Fetch Sessions
https://sub.domain.com (Domain of your API)/typebot/fetchSessions/:typebotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
typebotId
Default Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Default Settings
https://sub.domain.com (Domain of your API)/typebot/settings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 10,
    "ignoreJids": [],
    "typebotIdFallback": "clyja4oys0a3uqpy7k3bd7swe"
}
GET
Fetch Default Settings
https://sub.domain.com (Domain of your API)/typebot/fetchSettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Typebot
https://sub.domain.com (Domain of your API)/typebot/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "enabled": true,
    "url": "https://bot.dgcode.com.br",
    "typebot": "my-typebot-uoz1rg9",
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "regex", /* contains, equals, startsWith, endsWith, regex */
    "triggerValue": "^atend.*",
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 10
}
GET
Find Typebots
https://sub.domain.com (Domain of your API)/typebot/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch Typebot
https://sub.domain.com (Domain of your API)/typebot/fetch/:typebotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
typebotId
clx6niurm0001lzrhhqqe72yq
PUT
Update Typebot
https://sub.domain.com (Domain of your API)/typebot/update/:typebotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
typebotId
clx6niurm0001lzrhhqqe72yq
Body
raw (json)
View More
json
{
	"enabled": true,
    "url": "https://bot.dgcode.com.br",
    "typebot":  "my-typebot-uoz1rg9",
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 10,
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "contains", /* contains, equals, startsWith, endsWith */
    "triggerValue": "evolution"
}
DELETE
Delete Typebot
https://sub.domain.com (Domain of your API)/typebot/delete/:typebotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
typebotId
clx6niurm0001lzrhhqqe72yq
POST
Start Typebot
https://sub.domain.com (Domain of your API)/typebot/start/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "url": "https://bot.dgcode.com.br",
    "typebot": "fluxo-unico-3uuso28",
    "remoteJid": "557499879409@s.whatsapp.net",
    "startSession": false,
    "variables": [
        {
            "name": "pushName",
            "value": "Davidson Gomes"
        }
    ]
}
Evolution Bot
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Session
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Change Session Status
https://sub.domain.com (Domain of your API)/evolutionBot/changeStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "remoteJid": "5511912345678@s.whatsapp.net",
    "status": "closed" /* opened, paused, closed */
}
GET
Fetch Sessions
https://sub.domain.com (Domain of your API)/evolutionBot/fetchSessions/:evolutionBotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
evolutionBotId
Default Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Default Settings
https://sub.domain.com (Domain of your API)/evolutionBot/settings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": [],
    "botIdFallback": "clyja4oys0a3uqpy7k3bd7swe"
}
GET
Fetch Default Settings
https://sub.domain.com (Domain of your API)/evolutionBot/fetchSettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Bots
https://sub.domain.com (Domain of your API)/evolutionBot/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "enabled": true,
    "apiUrl": "http://api.site.com/v1",
    "apiKey": "app-123456", // optional
    // options
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
    "triggerValue": "teste",
    "expire": 0,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": []
}
GET
Find Bots
https://sub.domain.com (Domain of your API)/evolutionBot/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch Bot
https://sub.domain.com (Domain of your API)/evolutionBot/fetch/:evolutionBotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
evolutionBotId
DELETE
Delete Bot
https://sub.domain.com (Domain of your API)/evolutionBot/delete/:evolutionBotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
evolutionBotId
Openai
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Openai Session
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Change Session Status
https://sub.domain.com (Domain of your API)/openai/changeStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "remoteJid": "5511912345678@s.whatsapp.net",
    "status": "closed" /* opened, paused, closed */
}
GET
Fetch Sessions
https://sub.domain.com (Domain of your API)/openai/fetchSessions/:openaiBotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
openaiBotId
Default Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Default Settings
https://sub.domain.com (Domain of your API)/openai/settings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "openaiCredsId": "clyja4oys0a3uqpy7k3bd7swe",
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": [],
    "openaiIdFallback": "clyja4oys0a3uqpy7k3bd7swe"
}
GET
Fetch Default Settings
https://sub.domain.com (Domain of your API)/openai/fetchSettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Openai Creds
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Openai Creds
https://sub.domain.com (Domain of your API)/openai/creds/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "name": "apikey",
    "apiKey": "sk-proj-..."
}
GET
Get Openai Creds
https://sub.domain.com (Domain of your API)/openai/creds/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
DELETE
Delete Openai Creds
https://sub.domain.com (Domain of your API)/openai/creds/:openaiCredsId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
openaiCredsId
PUT
Update Openai Bot
https://sub.domain.com (Domain of your API)/openai/update/:openaiBotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
openaiBotId
Body
raw (json)
View More
json
{
	"enabled": true,
	"openaiCredsId": "clyrx36wj0001119ucjjzxik1",
	"botType": "assistant", /* assistant or chatCompletion */
	// for assistants
	"assistantId": "asst_LRNyh6qC4qq8NTyPjHbcJjSp",
    "functionUrl": "https://webhook.com",
	// for chat completion
	"model": "gpt-4o",
	"systemMessages": [
		"You are a helpful assistant."
	],
	"assistantMessages": [
		"\n\nHello there, how may I assist you today?"
	],
	"userMessages": [
		"Hello!"
	],
	"maxTokens": 300,
	// options
	"triggerType": "keyword", /* all or keyword */
	"triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
	"triggerValue": "teste",
	"expire": 20,
	"keywordFinish": "#SAIR",
	"delayMessage": 1000,
	"unknownMessage": "Mensagem não reconhecida",
	"listeningFromMe": false,
	"stopBotFromMe": false,
	"keepOpen": false,
	"debounceTime": 10,
	"ignoreJids": []
}
DELETE
Delete Openai Bot
https://sub.domain.com (Domain of your API)/openai/delete/:openaiBotId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
openaiBotId
Dify
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Dify Session
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Change Session Status
https://sub.domain.com (Domain of your API)/dify/changeStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "remoteJid": "5511912345678@s.whatsapp.net",
    "status": "closed" /* opened, paused, closed */
}
GET
Fetch Sessions
https://sub.domain.com (Domain of your API)/dify/fetchSessions/:difyId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
difyId
Default Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Default Settings
https://sub.domain.com (Domain of your API)/dify/settings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": [],
    "difyIdFallback": "clyja4oys0a3uqpy7k3bd7swe"
}
GET
Fetch Default Settings
https://sub.domain.com (Domain of your API)/dify/fetchSettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Dify Bots
https://sub.domain.com (Domain of your API)/dify/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "enabled": true,
    "botType": "chatBot", /* chatBot, textGenerator, agent, workflow */
    "apiUrl": "http://dify.site.com/v1",
    "apiKey": "app-123456",
    // options
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
    "triggerValue": "teste",
    "expire": 0,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": []
}
GET
Find Dify Bots
https://sub.domain.com (Domain of your API)/dify/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch Dify Bot
https://sub.domain.com (Domain of your API)/dify/fetch/:difyId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
difyId
DELETE
Delete Dify Bot
https://sub.domain.com (Domain of your API)/dify/delete/:difyId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
difyId
Flowise
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
Flowise Session
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Change Session Status
https://sub.domain.com (Domain of your API)/flowise/changeStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "remoteJid": "5511912345678@s.whatsapp.net",
    "status": "closed" /* opened, paused, closed */
}
GET
Fetch Sessions
https://sub.domain.com (Domain of your API)/flowise/fetchSessions/:difyId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
difyId
Default Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Default Settings
https://sub.domain.com (Domain of your API)/flowise/settings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": [],
    "flowiseIdFallback": "clyja4oys0a3uqpy7k3bd7swe"
}
GET
Fetch Default Settings
https://sub.domain.com (Domain of your API)/flowise/fetchSettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Flowise Bots
https://sub.domain.com (Domain of your API)/flowise/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "enabled": true,
    "apiUrl": "http://flowise.site.com/v1",
    "apiKey": "app-123456", // optional
    // options
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
    "triggerValue": "teste",
    "expire": 0,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": []
}
GET
Find Flowise Bots
https://sub.domain.com (Domain of your API)/flowise/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch Flowise Bot
https://sub.domain.com (Domain of your API)/flowise/fetch/:flowiseId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
flowiseId
PUT
Update Flowise Bot
https://sub.domain.com (Domain of your API)/flowise/update/:flowiseId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
flowiseId
Body
raw (json)
View More
json
{
    "enabled": true,
    "apiUrl": "http://dify.site.com/v1",
    "apiKey": "app-123456", // optional
    // options
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
    "triggerValue": "teste",
    "expire": 0,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": []
}
DELETE
Delete Flowise Bot
https://sub.domain.com (Domain of your API)/flowise/delete/:flowiseId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
flowiseId
N8N
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
N8N Session
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Change Session Status
https://sub.domain.com (Domain of your API)/n8n/changeStatus/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "remoteJid": "5511912345678@s.whatsapp.net",
    "status": "closed" /* opened, paused, closed */
}
GET
Fetch Sessions
https://sub.domain.com (Domain of your API)/n8n/fetchSessions/:difyId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
difyId
Default Settings
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Set Default Settings
https://sub.domain.com (Domain of your API)/n8n/settings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "expire": 20,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": [],
    "n8nIdFallback": "clyja4oys0a3uqpy7k3bd7swe"
}
GET
Fetch Default Settings
https://sub.domain.com (Domain of your API)/n8n/fetchSettings/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
POST
Create N8N Bots
https://sub.domain.com (Domain of your API)/n8n/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "enabled": true,
    "apiUrl": "http://flowise.site.com/v1",
    "apiKey": "app-123456", // optional
    // options
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
    "triggerValue": "teste",
    "expire": 0,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": []
}
GET
Find N8N Bots
https://sub.domain.com (Domain of your API)/n8n/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch N8N Bot
https://sub.domain.com (Domain of your API)/n8n/fetch/:n8nId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
n8nId
POST
Create EvoAI Bots
https://sub.domain.com (Domain of your API)/evoai/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "enabled": true,
    "apiUrl": "http://flowise.site.com/v1",
    "apiKey": "app-123456", // optional
    // options
    "triggerType": "keyword", /* all or keyword */
    "triggerOperator": "equals", /* contains, equals, startsWith, endsWith, regex, none */
    "triggerValue": "teste",
    "expire": 0,
    "keywordFinish": "#SAIR",
    "delayMessage": 1000,
    "unknownMessage": "Mensagem não reconhecida",
    "listeningFromMe": false,
    "stopBotFromMe": false,
    "keepOpen": false,
    "debounceTime": 0,
    "ignoreJids": []
}
GET
Find EvoAI Bots
https://sub.domain.com (Domain of your API)/evoai/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Fetch EvoAI Bot
https://sub.domain.com (Domain of your API)/evoai/fetch/:evoaiId/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Path Variables
evoaiId
Send Message
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Send Template
https://sub.domain.com (Domain of your API)/message/sendTemplate/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "number": "559999999999 (Recipient number with Country Code)",
    "name": "hello_world",
    "language": "en_US",
    // "webhookUrl": "", (optional)
    "components": [
        {
            "type": "body",
            "parameters": [
                {
                    "type": "text",
                    "text": "Name"
                },
                {
                    "type": "text",
                    "text": "email@email.com"
                }
            ]
        },
        {
            "type": "button",
            "sub_type": "URL",
            "index": "1",
            "parameters": [
                {
                    "type": "text",
                    "text": "/reset-password/1234"
                }
            ]
        }
    ]
}
Template
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Create Template
https://sub.domain.com (Domain of your API)/template/create/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "name": "teste_evolution",
    "category": "MARKETING", /* AUTHENTICATION, MARKETING, UTILITY */
    "allowCategoryChange": false,
    "language": "en_US",
    // "webhookUrl": "", (optional)
    "components": [
        {
            "type": "BODY",
            "text": "Thank you for your order, {{1}}! Your confirmation number is {{2}}. If you have any questions, please use the buttons below to contact support. Thank you for being a customer!",
            "example": {
                "body_text": [
                    [
                        "Pablo",
                        "860198-230332"
                    ]
                ]
            }
        },
        {
            "type": "BUTTONS",
            "buttons": [
                {
                    "type": "QUICK_REPLY",
                    "text": "Unsubscribe from Promos"
                },
                {
                    "type": "URL",
                    "text": "Contact Support",
                    "url": "https://atendai.com"
                }
            ]
        }
    ]
}
GET
Find Templates
https://sub.domain.com (Domain of your API)/template/find/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Evolution Channel
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Evolution Channel Webhook
https://sub.domain.com (Domain of your API)/webhook/evolution
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
View More
json
{
    "numberId": "559999999999 (Recipient number with Country Code)", // instance number
    "key": {
        "remoteJid": "559999999999 (Recipient number with Country Code)",
        "fromMe": false,
        "id": "ABC1234"
    },
    "pushName": "Contact Name",
    "message": {
        "conversation": "oi" // message text
        // for medias
        // "imageMessage": { // imageMessage, videoMessage, documentMessage
        //     "caption": "O que tem nessa foto?"
        // },
        // "mediaUrl": "https://t3.ftcdn.net/jpg/03/26/50/04/360_F_326500445_ZD1zFSz2cMT1qOOjDy7C5xCD4shawQfM.jpg"
    },
    "messageType": "conversation" // conversation. imageMessage, videoMessage, documentMessage, audioMessage
}
Storage
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
S3
﻿

Authorization
API Key
This folder is using an authorization helper from collection Evolution API | v2.3.*
POST
Get Media
https://sub.domain.com (Domain of your API)/s3/getMedia/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    // "id": "",
    // "type": "",
    // "messageId": ""
}
POST
Get Media Url
https://sub.domain.com (Domain of your API)/s3/getMediaUrl/instance (Instance name)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
Body
raw (json)
json
{
    "id": "clykhoqq70003pmm88bb6eejd"
    // "type": "",
    // "messageId": ""
}
GET
Get Informations
https://sub.domain.com (Domain of your API)
﻿

Authorization
API Key
This request is using an authorization helper from collection Evolution API | v2.3.*
GET
Metrics
https://sub.domain.com (Domain of your API)/metrics
﻿

Authorization
Basic Auth
Username
<username>
Password
<password>