plugins {
    id("com.android.application") version "9.4.1"
}

android {
    namespace = "io.github.domovou69.scalelab"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.domovou69.scalelab"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
    }
}
