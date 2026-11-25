// A voz de quem apresenta pela captura da Apple (o isolamento de voz do Mac vale aqui), sem o ganho automatico. Escreve
// no stdout o som em pedacos: float32, 48 kHz, mono. Para quando o stdin fecha. No stderr, so avisos curtos.
import AVFoundation
import Foundation

setvbuf(stdout, nil, _IOFBF, 1 << 16)
let engine = AVAudioEngine()
let input = engine.inputNode
let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
var converter: AVAudioConverter?

func say(_ text: String) { FileHandle.standardError.write((text + "\n").data(using: .utf8)!) }

do {
  try input.setVoiceProcessingEnabled(true)
  input.isVoiceProcessingAGCEnabled = false
  if #available(macOS 14.0, *) {
    // Sem abaixar o som dos outros programas (a musica ou o video que se compartilha).
    input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
  }
  let format = input.outputFormat(forBus: 0)
  converter = AVAudioConverter(from: AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false)!, to: out)
  say("pronto \(format.sampleRate) \(AVCaptureDevice.default(for: .audio)?.localizedName ?? "?")")
  input.installTap(onBus: 0, bufferSize: 480, format: format) { buffer, _ in
    guard let data = buffer.floatChannelData, buffer.frameLength > 0, let conv = converter else { return }
    let mono = AVAudioPCMBuffer(pcmFormat: conv.inputFormat, frameCapacity: buffer.frameLength)!
    mono.frameLength = buffer.frameLength
    memcpy(mono.floatChannelData![0], data[0], Int(buffer.frameLength) * 4)
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 48000 / format.sampleRate) + 16
    let result = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: capacity)!
    var used = false
    var error: NSError?
    conv.convert(to: result, error: &error) { _, status in
      if used { status.pointee = .noDataNow; return nil }
      used = true
      status.pointee = .haveData
      return mono
    }
    if result.frameLength > 0 {
      fwrite(result.floatChannelData![0], 4, Int(result.frameLength), stdout)
      fflush(stdout)
    }
  }
  engine.prepare()
  try engine.start()
} catch {
  say("erro \(error.localizedDescription)")
  exit(1)
}

// O modo do microfone escolhido na barra do Mac, de 2 em 2 s (para o relatorio).
Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
  let mode = AVCaptureDevice.activeMicrophoneMode
  say("modo \(mode == .voiceIsolation ? "isolamento" : mode == .wideSpectrum ? "amplo" : "padrao")")
}
FileHandle.standardInput.readabilityHandler = { handle in
  if handle.availableData.isEmpty { engine.stop(); exit(0) }
}
RunLoop.main.run()
