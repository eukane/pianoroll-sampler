/**
 * AudioContext 관리 + **모바일 오디오 잠금 해제**.
 *
 * iOS 사파리와 안드로이드 크롬은 사용자가 화면을 만지기 전에는 소리를 내주지
 * 않는다. AudioContext 를 만들어도 상태가 `suspended` 로 시작하고, 이걸 모르면
 * "재생 버튼을 눌렀는데 아무 일도 안 일어난다" 가 된다. 폰이 주 사용 환경이라
 * 이 처리를 M1 에서부터 넣는다.
 *
 * 해제 조건이 까다롭다.
 *   · resume() 은 **사용자 제스처 핸들러 안에서** 불려야 한다
 *   · iOS 는 resume() 만으로 부족한 경우가 있어, 길이 1 샘플짜리 무음 버퍼를
 *     한 번 재생해 줘야 오디오 경로가 실제로 열린다
 *   · 전화가 오거나 앱을 백그라운드로 보내면 다시 suspended 로 떨어진다.
 *     그래서 visibilitychange 에서 한 번 더 깨운다
 */

type Listener = () => void;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  private unlocked = false;
  private listeners: Listener[] = [];

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as any).webkitAudioContext;
    // latencyHint: "interactive" — 화면을 두드리자마자 소리가 나야 하는 앱이다.
    // 버퍼를 키우면 폰에서 끊김은 줄지만 반응이 눈에 띄게 늦다.
    this.ctx = new Ctor({ latencyHint: "interactive" });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.unlocked) void this.ctx.resume();
    });
  }

  get isUnlocked(): boolean {
    return this.unlocked && this.ctx.state === "running";
  }

  get currentTime(): number {
    return this.ctx.currentTime;
  }

  /** 반드시 사용자 제스처(pointerup/click/touchend) 핸들러 안에서 부를 것. */
  async unlock(): Promise<boolean> {
    try {
      if (this.ctx.state !== "running") await this.ctx.resume();

      // iOS 용 무음 버퍼 킥. 실패해도 치명적이지 않으니 조용히 넘어간다.
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      /* 무시 */
    }

    const ok = this.ctx.state === "running";
    if (ok && !this.unlocked) {
      this.unlocked = true;
      this.listeners.forEach((fn) => fn());
    }
    return ok;
  }

  onUnlock(fn: Listener): void {
    this.listeners.push(fn);
  }
}
