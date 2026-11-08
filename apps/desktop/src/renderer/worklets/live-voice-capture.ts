declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processor: new (...args: never[]) => AudioWorkletProcessor,
): void;

class AiTeamOSVoiceCapture extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (input) this.port.postMessage(new Float32Array(input));
    return true;
  }
}

registerProcessor("aiteamos-voice-capture", AiTeamOSVoiceCapture);
