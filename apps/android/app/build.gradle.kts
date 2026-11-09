plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    // PendingSend and MessageAttachment are @Serializable in this module. Without the
    // compiler plugin no serializer is generated and writing the outbox crashes on send.
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.aiteamos.android"
    compileSdk = 36

    val appLinkHost = (project.findProperty("aiteamosAppLinkHost") as String?)
        ?.trim()
        ?.lowercase()
        ?.removeSuffix(".")
        ?.takeIf(String::isNotEmpty)
        ?: "aiteamos.example.com"
    require(Regex("^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$").matches(appLinkHost)) {
        "aiteamosAppLinkHost must be a public DNS host without a scheme, path, port, or credentials"
    }

    // The root package.json is the single release version (see scripts/release/version.ts).
    val releaseVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
        .find(rootProject.file("package.json").readText())?.groupValues?.get(1)
        ?: error("Cannot read the release version from the root package.json")
    val versionMatch = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)(?:-[A-Za-z]+\\.(\\d+))?").find(releaseVersion)
        ?: error("Unsupported release version: $releaseVersion")
    // Play needs a strictly increasing integer: 0.1.0-beta.1 -> 10001, 0.1.0 -> 10099.
    val computedVersionCode = versionMatch.groupValues.let { (_, major, minor, patch, pre) ->
        (major.toInt() * 10_000 + minor.toInt() * 100 + patch.toInt()) * 100 +
            (if (pre.isEmpty()) 99 else pre.toInt().coerceIn(0, 98))
    }

    defaultConfig {
        applicationId = "com.teambots.android"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("aiteamosVersionCode") as String?)?.toInt() ?: computedVersionCode
        versionName = releaseVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["aiteamosAppLinkHost"] = appLinkHost
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }

    // Release signing comes only from the environment, never from the repository. Without
    // these variables the release build is left unsigned, and CI refuses to publish it.
    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf(String::isNotBlank)
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        debug {
            // Keep local/debug installs side-by-side with the signed release app.
            applicationIdSuffix = ".debug"
        }
        release {
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { compose = true }

    externalNativeBuild {
        cmake { path = file("src/main/cpp/CMakeLists.txt") }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appsearch:appsearch:1.1.0-alpha06")
    implementation("androidx.appsearch:appsearch-local-storage:1.1.0-alpha06")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.google.firebase:firebase-messaging:24.1.1")
    implementation(project(":mobile:shared"))

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
