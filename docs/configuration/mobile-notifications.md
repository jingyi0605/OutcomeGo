# Mobile notifications

iPhone alerts need both permission on the phone and Apple Push Notification service (APNs) credentials on your aiTeamOS server. Importing or changing the server credentials applies live, without restarting the deployment.

## Enable alerts on iPhone

1. Connect the iPhone app to your aiTeamOS server and sign in.
2. Open **Settings → Notifications**, enable notifications, and allow them when iOS asks.
3. Under **Bot notifications**, choose which bots notify you.

If iOS permission was previously denied, allow aiTeamOS in the iPhone's system notification settings. Focus and Do Not Disturb can silence alerts. aiTeamOS also suppresses alerts for the conversation you are viewing.

By default, **Pause iPhone alerts while I’m using my Mac** keeps your phone
quiet while you use a Mac running aiTeamOS, including other Mac applications.
Phone alerts resume for new activity after five minutes of Mac inactivity or when
the Mac locks, sleeps, or quits aiTeamOS. While aiTeamOS is open on your iPhone, it
alerts as usual. The Mac shows its own banners whenever aiTeamOS isn't the window
you're using. Turn this shared setting off in either app's settings to receive
independent alerts on both devices. Earlier suppressed alerts are not replayed; their
messages remain unread until you read them.

## Get the matching Apple credentials

The signing key must belong to the Apple Developer team that signed your iPhone app, and must allow pushes for that app's bundle ID. A key from an unrelated Apple account will not work with the distributed aiTeamOS app.

The iPhone app's bundle ID is `dev.aiteamos.mobile`, signed by Apple team `828JR8JA8V`. Use an APNs key from that team. If you build the iPhone app yourself, use your build's Apple team and bundle ID instead.

If you manage that Apple Developer team, follow [Apple's key creation instructions](https://developer.apple.com/help/account/keys/create-a-private-key/): enable **Apple Push Notification service**, configure the allowed environment and topics, and download the `.p8` key. Record its **Key ID** and your **Team ID**. TestFlight and App Store builds use production APNs; development builds use development APNs. The key must allow the environment your app uses. Apple allows the private key to be downloaded only once, so retain it securely.

## Import credentials on the server

Run these commands on the computer hosting your aiTeamOS server. For a remote server, connect to that host first. Place the `.p8` key there and create `apns.json` alongside it:

```json
{
  "keyId": "ABCDE12345",
  "teamId": "FGHIJ67890",
  "topic": "dev.aiteamos.mobile",
  "privateKeyFile": "./AuthKey.p8"
}
```

Replace the example IDs and key filename with your real values. The key path is relative to the JSON file.

```sh
aiteamos notifications configure --config ./apns.json
aiteamos notifications status
aiteamos doctor
```

You can also import the key directly:

```sh
aiteamos notifications configure \
  --key-file ./AuthKey.p8 \
  --key-id ABCDE12345 \
  --team-id FGHIJ67890 \
  --topic dev.aiteamos.mobile
```

If your installation uses a custom folder, add `--dir /path/to/installation`. If the command is unavailable, update to a release that supports live APNs configuration first.

The CLI validates the IDs, bundle-ID format, and P-256 signing key before importing. The server saves the key encrypted in PostgreSQL. Every worker reads the saved configuration before its next push, so later imports and key rotations need no restart. APNs credentials do not need to be added to `.env`; that file still holds installation settings and the control token used to protect the saved key. Keep it with your database backups, or import the Apple key again after changing the control token.

## Verify delivery

`notifications status` shows the configuration source and local validation result without returning the key. Doctor checks iOS registration, the running worker's credentials, app bundle-ID matches, and recent push errors. Without an eligible iPhone registration, missing credentials produce a warning; with an eligible iPhone, they block readiness.

Neither command sends a test alert or proves that Apple accepts the key. To verify delivery, allow aiTeamOS through Focus, leave the bot's conversation closed, and have that bot send a message or finish a task. Confirm that the alert appears on the iPhone.

If alerts do not arrive, check that the phone is connected to the server you configured, retry registration by turning app notifications off and on, and inspect `aiteamos logs worker`. Check the signing team, app bundle ID, key environment, and whether Apple has revoked the key. After fixing a configuration error, trigger a new notification; an old failed delivery may have exhausted its retries.

Desktop alerts and notifications generated locally on the phone do not require APNs credentials. See [settings and notifications](apps.md#notifications) for device and bot preferences.
