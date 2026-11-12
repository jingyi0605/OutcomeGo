package com.outcomego.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class AndroidUpdateManifestTest {
    private val fixtureKeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()
    private val fixturePublicKeyDerHex = fixtureKeyPair.public.encoded.joinToString("") {
        "%02x".format(it.toInt() and 0xff)
    }
    private val unsignedManifest = AndroidUpdateManifest(
        version = "1.2.3",
        versionCode = 10203,
        applicationId = "com.outcomego.android",
        apkUrl = "https://github.com/jingyi0605/OutcomeGo/releases/download/v1.2.3/OutcomeGo-1.2.3-android.apk",
        sizeBytes = 12345,
        sha256 = "0000000000000000000000000000000000000000000000000000000000000000",
        certificateSha256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        signatureBase64 = "fixture-signature",
    )
    private val validManifest = unsignedManifest.copy(
        signatureBase64 = Base64.getEncoder().encodeToString(
            Signature.getInstance("SHA256withECDSA").run {
                initSign(fixtureKeyPair.private)
                update(AndroidUpdateManifestVerifier.canonicalPayload(unsignedManifest).toByteArray(Charsets.UTF_8))
                sign()
            },
        ),
    )

    @Test
    fun canonicalPayloadIsStableAndUsesLowercaseDigests() {
        assertEquals(
            "version=1.2.3\n" +
                "versionCode=10203\n" +
                "applicationId=com.outcomego.android\n" +
                "apkUrl=https://github.com/jingyi0605/OutcomeGo/releases/download/v1.2.3/OutcomeGo-1.2.3-android.apk\n" +
                "sizeBytes=12345\n" +
                "sha256=0000000000000000000000000000000000000000000000000000000000000000\n" +
                "certificateSha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\n",
            AndroidUpdateManifestVerifier.canonicalPayload(validManifest),
        )
    }

    @Test
    fun validSignedManifestIsAccepted() {
        val parsed = AndroidUpdateManifestVerifier.parseAndVerify(
            Json.encodeToString(validManifest),
            "com.outcomego.android",
            fixturePublicKeyDerHex,
        )
        assertEquals(validManifest, parsed)
    }

    @Test
    fun tamperedPayloadIsRejected() {
        val tampered = validManifest.copy(version = "1.2.4")
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUpdateManifestVerifier.parseAndVerify(
                Json.encodeToString(tampered),
                "com.outcomego.android",
                fixturePublicKeyDerHex,
            )
        }
    }

    @Test
    fun invalidTransportVersionAndChecksumAreRejected() {
        val invalidUrl = validManifest.copy(apkUrl = "http://example.com/update.apk")
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUpdateManifestVerifier.parseAndVerify(
                Json.encodeToString(invalidUrl),
                "com.outcomego.android",
                fixturePublicKeyDerHex,
            )
        }
        val invalidVersion = validManifest.copy(version = "1.2")
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUpdateManifestVerifier.parseAndVerify(
                Json.encodeToString(invalidVersion),
                "com.outcomego.android",
                fixturePublicKeyDerHex,
            )
        }
        val invalidChecksum = validManifest.copy(sha256 = "not-a-checksum")
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUpdateManifestVerifier.parseAndVerify(
                Json.encodeToString(invalidChecksum),
                "com.outcomego.android",
                fixturePublicKeyDerHex,
            )
        }
    }
}
