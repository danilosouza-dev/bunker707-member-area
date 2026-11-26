// A voz de quem apresenta pela captura da Apple (o isolamento de voz do Mac vale aqui), sem o ganho automatico. Escreve
// no stdout o som em pedacos: float32, 48 kHz, mono. Para quando o stdin fecha. No stderr, so avisos curtos.
// O primeiro argumento e o nome do microfone escolhido na sala (o do sistema, sem o "(3142:a008)" do navegador); sem ele,
// ou sem um aparelho com esse nome, vale o microfone padrao do Mac.
import AVFoundation
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOFBF, 1 << 16)
let engine = AVAudioEngine()
let input = engine.inputNode
let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
var converter: AVAudioConverter?

func say(_ text: String) { FileHandle.standardError.write((text + "\n").data(using: .utf8)!) }

/** O aparelho de entrada com esse nome (o comeco do nome, sem maiusculas), ou nulo. */
func inputDevice(named wanted: String) -> AudioDeviceID? {
  var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return nil }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return nil }
  let target = wanted.lowercased().trimmingCharacters(in: .whitespaces)
  for id in ids {
    var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var count: UInt32 = 0
    if AudioObjectGetPropertyDataSize(id, &streams, 0, nil, &count) != noErr || count == 0 { continue }
    var nameAddress = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var name: Unmanaged<CFString>?
    var nameSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &nameAddress, 0, nil, &nameSize, &name) == noErr, let text = name?.takeRetainedValue() as String? else { continue }
    if !target.isEmpty && text.lowercased().hasPrefix(target) { return id }
  }
  return nil
}

do {
  let wanted = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
  if let device = inputDevice(named: wanted), let unit = input.audioUnit {
    var id = device
    let status = AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
    say(status == noErr ? "microfone \(wanted)" : "microfone padrao (nao troquei: \(status))")
  } else {
    say("microfone padrao (sem \"\(wanted)\")")
  }
  try input.setVoiceProcessingEnabled(true)
  input.isVoiceProcessingAGCEnabled = false
  if #available(macOS 14.0, *) {
    // Sem abaixar o som dos outros programas (a musica ou o video que se compartilha).
    input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
  }
  let format = input.outputFormat(forBus: 0)
  converter = AVAudioConverter(from: AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false)!, to: out)
  say("pronto \(format.sampleRate)")
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
