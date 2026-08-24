/**
 * 리버브 — 임펄스 응답을 **계산으로 만든다.**
 *
 * 보통은 실제 공간에서 녹음한 IR 파일을 쓰지만, 그러면 음원 파일이 하나 더
 * 생기고 라이선스도 따라온다. 이 프로그램은 사용자가 넣는 음원 말고는 아무
 * 파일도 들고 있지 않기로 했다(README 의 "음원을 번들로 넣지 않는다").
 * 그래서 잡음을 지수로 감쇠시켜 방 울림을 흉내 낸다.
 *
 * 소리를 그럴듯하게 만드는 게 목적이 아니라 **마른 소리에 공간감을 얹는 것**이
 * 목적이다. 국악기 단음 샘플은 특히 마른데, 살짝만 얹어도 훨씬 악기 같아진다.
 *
 * 프리딜레이를 조금 둔다. 원음과 울림이 동시에 시작하면 소리가 뭉개져서
 * 음정이 흐려진다.
 */

const SECONDS = 1.8;
const PREDELAY = 0.02;

export function createReverb(ctx: BaseAudioContext): ConvolverNode {
  const rate = ctx.sampleRate;
  const frames = Math.floor(rate * SECONDS);
  const predelay = Math.floor(rate * PREDELAY);
  const ir = ctx.createBuffer(2, frames, rate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = ir.getChannelData(channel);
    for (let i = predelay; i < frames; i += 1) {
      const t = (i - predelay) / (frames - predelay);
      // 지수 감쇠. 뒤로 갈수록 빠르게 잦아들어야 꼬리가 질척이지 않는다.
      const decay = Math.pow(1 - t, 2.6);
      // 고음이 먼저 죽는 실제 공간을 흉내 내려고 뒤쪽 잡음을 살짝 뭉갠다.
      const noise = Math.random() * 2 - 1;
      data[i] = noise * decay;
    }
    // 아주 짧은 페이드인. 없으면 시작부에서 딸깍거린다.
    const fade = Math.min(64, frames - predelay);
    for (let i = 0; i < fade; i += 1) data[predelay + i] *= i / fade;
  }

  const convolver = ctx.createConvolver();
  convolver.buffer = ir;
  return convolver;
}
