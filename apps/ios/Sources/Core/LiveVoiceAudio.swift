import AVFAudio
import Foundation

#if os(iOS)
public final class LiveVoiceAudio: NSObject {
  private let session = AVAudioSession.sharedInstance()
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var configured = false
  private var inputHandler: ((Data) -> Void)?
  private var playbackAckHandler: ((UInt32, UInt32) -> Void)?
  private var inputPCM = [Int16]()
  private var inputEncoder: AVAudioConverter?
  private var inputResampler: AVAudioConverter?
  private var outputDecoder: AVAudioConverter?
  private var inputOpusFormat: AVAudioFormat?
  private var outputOpusFormat: AVAudioFormat?
  private var playerAttached = false
  private var previousCategory: AVAudioSession.Category?
  private var previousMode: AVAudioSession.Mode?
  private var previousOptions: AVAudioSession.CategoryOptions?
  private let frameSize = 960

  public override init() {
    super.init()
  }

  public func start(
    onInput: ((Data) -> Void)? = nil,
    onPlaybackAck: ((UInt32, UInt32) -> Void)? = nil
  ) throws {
    inputHandler = onInput
    playbackAckHandler = onPlaybackAck
    previousCategory = session.category
    previousMode = session.mode
    previousOptions = session.categoryOptions

    try session.setCategory(
      .playAndRecord,
      mode: .voiceChat,
      options: [.allowBluetoothHFP, .defaultToSpeaker, .mixWithOthers]
    )
    try session.setActive(true)
    try engine.inputNode.setVoiceProcessingEnabled(true)

    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    guard let pcmFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: 48_000,
      channels: 1,
      interleaved: true
    ), let inputOpusFormat = Self.makeOpusFormat(sampleRate: 48_000),
      let outputOpusFormat = Self.makeOpusFormat(sampleRate: 24_000) else {
      throw APIError("This device does not support the realtime voice audio format.")
    }
    self.inputOpusFormat = inputOpusFormat
    self.outputOpusFormat = outputOpusFormat
    inputEncoder = AVAudioConverter(from: pcmFormat, to: inputOpusFormat)
    inputResampler = AVAudioConverter(from: inputFormat, to: pcmFormat)
    outputDecoder = AVAudioConverter(from: outputOpusFormat, to: Self.makePCMFormat(sampleRate: 24_000))
    guard inputEncoder != nil, inputResampler != nil, outputDecoder != nil else {
      throw APIError("This device does not support Opus realtime voice audio.")
    }

    if !playerAttached {
      engine.attach(player)
      engine.connect(player, to: engine.mainMixerNode, format: Self.makePCMFormat(sampleRate: 24_000))
      playerAttached = true
    }
    installInputTap(inputFormat: inputFormat)
    observeAudioLifecycle()
    engine.prepare()
    try engine.start()
    player.play()
    configured = true
  }

  public func stopPlayback() {
    player.stop()
    player.reset()
  }

  public func playOutputPacket(_ packet: Data, generation: UInt32, sequence: UInt32) {
    guard configured, let decoded = decode(packet) else { return }
    player.scheduleBuffer(decoded, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.playbackAckHandler?(generation, sequence)
    }
    if !player.isPlaying { player.play() }
  }

  public func stop() {
    NotificationCenter.default.removeObserver(self)
    engine.inputNode.removeTap(onBus: 0)
    player.stop()
    player.reset()
    engine.stop()
    inputPCM.removeAll(keepingCapacity: false)
    inputEncoder = nil
    inputResampler = nil
    outputDecoder = nil
    inputOpusFormat = nil
    outputOpusFormat = nil
    inputHandler = nil
    playbackAckHandler = nil
    if let previousCategory, let previousMode, let previousOptions {
      try? session.setCategory(previousCategory, mode: previousMode, options: previousOptions)
    }
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
    self.previousCategory = nil
    self.previousMode = nil
    self.previousOptions = nil
    configured = false
  }

  public var isConfigured: Bool { configured }

  private func installInputTap(inputFormat: AVAudioFormat) {
    engine.inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(frameSize), format: inputFormat) {
      [weak self] buffer, _ in
      guard let self else { return }
      self.appendInput(buffer)
    }
  }

  private func appendInput(_ buffer: AVAudioPCMBuffer) {
    guard let resampler = inputResampler,
      let pcmFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 48_000, channels: 1, interleaved: true
      ),
      let converted = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: 2_000)
    else { return }
    var supplied = false
    var conversionError: NSError?
    let status = resampler.convert(to: converted, error: &conversionError) { _, inputStatus in
      if supplied {
        inputStatus.pointee = .endOfStream
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return buffer
    }
    guard (status == .haveData || status == .inputRanDry), conversionError == nil else { return }
    let count = Int(converted.frameLength)
    guard count > 0 else { return }
    if let samples = converted.int16ChannelData {
      inputPCM.append(contentsOf: UnsafeBufferPointer(start: samples[0], count: count))
    } else {
      return
    }

    while inputPCM.count >= frameSize {
      let frame = Array(inputPCM.prefix(frameSize))
      inputPCM.removeFirst(frameSize)
      if let packet = encode(frame) { inputHandler?(packet) }
    }
  }

  private func encode(_ samples: [Int16]) -> Data? {
    guard let converter = inputEncoder,
      let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 48_000, channels: 1, interleaved: true
      ),
      let source = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameSize)),
      let destinationFormat = inputOpusFormat
    else { return nil }
    source.frameLength = AVAudioFrameCount(frameSize)
    let destination = AVAudioCompressedBuffer(
      format: destinationFormat, packetCapacity: 1, maximumPacketSize: 1_275
    )
    samples.withUnsafeBufferPointer { values in
      guard let target = source.int16ChannelData?[0], let base = values.baseAddress else { return }
      target.update(from: base, count: values.count)
    }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: destination, error: &error) { _, inputStatus in
      if supplied {
        inputStatus.pointee = .endOfStream
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return source
    }
    guard status == .haveData, error == nil, destination.byteLength > 0 else { return nil }
    return Data(bytes: destination.data, count: Int(destination.byteLength))
  }

  private func decode(_ packet: Data) -> AVAudioPCMBuffer? {
    guard let converter = outputDecoder, let format = outputOpusFormat,
      packet.count <= 1_275
    else { return nil }
    let source = AVAudioCompressedBuffer(
      format: format, packetCapacity: 1, maximumPacketSize: 1_275
    )
    packet.copyBytes(to: source.data.assumingMemoryBound(to: UInt8.self), count: packet.count)
    source.byteLength = UInt32(packet.count)
    source.packetCount = 1
    if let descriptions = source.packetDescriptions {
      descriptions[0] = AudioStreamPacketDescription(
        mStartOffset: 0, mVariableFramesInPacket: 480, mDataByteSize: UInt32(packet.count)
      )
    }
    guard let destination = AVAudioPCMBuffer(
      pcmFormat: Self.makePCMFormat(sampleRate: 24_000), frameCapacity: AVAudioFrameCount(480)
    ) else { return nil }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: destination, error: &error) { _, inputStatus in
      if supplied {
        inputStatus.pointee = .endOfStream
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return source
    }
    return status == .haveData && error == nil && destination.frameLength > 0 ? destination : nil
  }

  private func observeAudioLifecycle() {
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification, object: session
    )
    center.addObserver(
      self, selector: #selector(handleRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification, object: session
    )
    center.addObserver(
      self, selector: #selector(handleMediaServicesReset(_:)),
      name: AVAudioSession.mediaServicesWereResetNotification, object: session
    )
  }

  @objc private func handleInterruption(_ notification: Notification) {
    guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let interruption = AVAudioSession.InterruptionType(rawValue: type)
    else { return }
    if interruption == .began {
      stopPlayback()
    } else if interruption == .ended {
      try? session.setActive(true)
      if configured, !engine.isRunning { try? engine.start() }
      if configured, !player.isPlaying { player.play() }
    }
  }

  @objc private func handleRouteChange(_ notification: Notification) {
    guard let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
    else { return }
    if reason == .oldDeviceUnavailable { stopPlayback() }
  }

  @objc private func handleMediaServicesReset(_ notification: Notification) {
    guard configured else { return }
    try? session.setActive(true)
    if !engine.isRunning { try? engine.start() }
  }

  private static func makePCMFormat(sampleRate: Double) -> AVAudioFormat {
    AVAudioFormat(
      commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true
    )!
  }

  private static func makeOpusFormat(sampleRate: Double) -> AVAudioFormat? {
    var description = AudioStreamBasicDescription(
      mSampleRate: sampleRate,
      mFormatID: kAudioFormatOpus,
      mFormatFlags: 0,
      mBytesPerPacket: 0,
      mFramesPerPacket: sampleRate == 24_000 ? 480 : 960,
      mBytesPerFrame: 0,
      mChannelsPerFrame: 1,
      mBitsPerChannel: 0,
      mReserved: 0
    )
    return AVAudioFormat(streamDescription: &description)
  }
}
#else
public final class LiveVoiceAudio {
  public init() {}
  public func start(
    onInput: ((Data) -> Void)? = nil,
    onPlaybackAck: ((UInt32, UInt32) -> Void)? = nil
  ) throws {
    throw NSError(
      domain: "OutcomeGo.LiveVoice", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Live voice audio is only available on iOS."]
    )
  }
  public func stopPlayback() {}
  public func playOutputPacket(_ packet: Data, generation: UInt32, sequence: UInt32) {}
  public func stop() {}
  public var isConfigured: Bool { false }
}
#endif
