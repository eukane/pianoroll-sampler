/**
 * AudioBuffer → WAV (44.1kHz / 16bit PCM).
 *
 * 스펙이 16비트를 못박았고, 실제로도 그게 맞다. FL Studio Mobile 을 비롯한
 * 모바일 DAW 와 유튜브·카톡까지 어디에 넣어도 그냥 열린다. 32비트 float 는
 * 편집 단계에서나 의미가 있고 받는 쪽에서 못 여는 경우가 생긴다.
 */

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);

  const str = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };

  str(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 청크 길이
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataBytes, true);

  const source: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) source.push(buffer.getChannelData(c));

  let at = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      // 넘치는 값은 잘라낸다. 안 자르면 16비트로 접힐 때 소리가 뒤집혀
      // 지직거린다 (wrap-around).
      const sample = Math.max(-1, Math.min(1, source[c][i]));
      view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  }

  return new Blob([out], { type: "audio/wav" });
}

/** 최고 음량. 0 이면 완전한 무음 — 뭔가 잘못됐다는 뜻이라 화면에 알려 준다. */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}
