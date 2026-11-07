import AVFAudio

#if os(iOS)
public final class LiveVoiceAudio {
  private let session = AVAudioSession.sharedInstance()
  private let engine = AVAudioEngine()
  private var configured = false

  public init() {}

  public func start() throws {
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
    try session.setActive(true)
    try engine.inputNode.setVoiceProcessingEnabled(true)
    configured = true
    engine.prepare()
    try engine.start()
  }

  public func stop() {
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
    configured = false
  }

  public func opusConverter(sampleRate: Double = 48_000) -> AVAudioConverter? {
    let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true)
    var description = AudioStreamBasicDescription(mSampleRate: sampleRate, mFormatID: kAudioFormatOpus, mFormatFlags: 0, mBytesPerPacket: 0, mFramesPerPacket: 960, mBytesPerFrame: 0, mChannelsPerFrame: 1, mBitsPerChannel: 0, mReserved: 0)
    guard let opus = AVAudioFormat(streamDescription: &description), let pcm else { return nil }
    return AVAudioConverter(from: pcm, to: opus)
  }

  public var isConfigured: Bool { configured }
}
#else
public final class LiveVoiceAudio {
  public init() {}
  public func start() throws { throw NSError(domain: "OpenTeam.LiveVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Live voice audio is only available on iOS."]) }
  public func stop() {}
  public var isConfigured: Bool { false }
}
#endif
