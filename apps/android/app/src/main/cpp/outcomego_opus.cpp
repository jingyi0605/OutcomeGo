#include <jni.h>
#include <opus.h>
#include <algorithm>
#include <cstdint>
#include <vector>

namespace {
struct Codec {
  OpusEncoder* encoder;
  OpusDecoder* decoder;
  int sampleRate;
};

Codec* asCodec(jlong value) { return reinterpret_cast<Codec*>(value); }
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_outcomego_platform_AndroidOpus_nativeCreate(JNIEnv*, jobject, jint sampleRate) {
  int encoderError = OPUS_OK;
  int decoderError = OPUS_OK;
  auto* codec = new Codec{
      opus_encoder_create(sampleRate, 1, OPUS_APPLICATION_VOIP, &encoderError),
      opus_decoder_create(sampleRate, 1, &decoderError),
      sampleRate,
  };
  if (encoderError != OPUS_OK || decoderError != OPUS_OK || !codec->encoder || !codec->decoder) {
    if (codec->encoder) opus_encoder_destroy(codec->encoder);
    if (codec->decoder) opus_decoder_destroy(codec->decoder);
    delete codec;
    return 0;
  }
  opus_encoder_ctl(codec->encoder, OPUS_SET_BITRATE(24000));
  opus_encoder_ctl(codec->encoder, OPUS_SET_COMPLEXITY(5));
  return reinterpret_cast<jlong>(codec);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_outcomego_platform_AndroidOpus_nativeEncode(JNIEnv* env, jobject, jlong handle, jshortArray input) {
  auto* codec = asCodec(handle);
  if (!codec || !input) return nullptr;
  const jsize samples = env->GetArrayLength(input);
  std::vector<jshort> pcm(static_cast<size_t>(samples));
  env->GetShortArrayRegion(input, 0, samples, pcm.data());
  std::vector<unsigned char> packet(1500);
  const int encoded = opus_encode(codec->encoder, reinterpret_cast<const opus_int16*>(pcm.data()), samples, packet.data(), static_cast<int>(packet.size()));
  if (encoded <= 0) return nullptr;
  jbyteArray output = env->NewByteArray(encoded);
  env->SetByteArrayRegion(output, 0, encoded, reinterpret_cast<const jbyte*>(packet.data()));
  return output;
}

extern "C" JNIEXPORT jshortArray JNICALL
Java_com_outcomego_platform_AndroidOpus_nativeDecode(JNIEnv* env, jobject, jlong handle, jbyteArray input) {
  auto* codec = asCodec(handle);
  if (!codec || !input) return nullptr;
  const jsize bytes = env->GetArrayLength(input);
  std::vector<jbyte> packet(static_cast<size_t>(bytes));
  env->GetByteArrayRegion(input, 0, bytes, packet.data());
  const int frameSize = codec->sampleRate == 24000 ? 480 : 960;
  std::vector<opus_int16> pcm(static_cast<size_t>(frameSize));
  const int decoded = opus_decode(codec->decoder, reinterpret_cast<const unsigned char*>(packet.data()), bytes, pcm.data(), frameSize, 0);
  if (decoded <= 0) return nullptr;
  jshortArray output = env->NewShortArray(decoded);
  env->SetShortArrayRegion(output, 0, decoded, reinterpret_cast<const jshort*>(pcm.data()));
  return output;
}

extern "C" JNIEXPORT void JNICALL
Java_com_outcomego_platform_AndroidOpus_nativeClose(JNIEnv*, jobject, jlong handle) {
  auto* codec = asCodec(handle);
  if (!codec) return;
  opus_encoder_destroy(codec->encoder);
  opus_decoder_destroy(codec->decoder);
  delete codec;
}
