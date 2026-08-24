/**
 * 실행 취소 / 다시 실행.
 *
 * 프로젝트를 통째로 복사해 쌓는다. 무엇이 어떻게 바뀌었는지 기록하는(커맨드
 * 패턴) 방식이 메모리는 덜 먹지만, 편집 종류가 늘 때마다 되돌리는 코드도 같이
 * 늘고 하나만 빠뜨려도 되돌리기가 조용히 깨진다. 이 앱의 프로젝트는 노트
 * 수천 개라도 JSON 몇백 KB 라서, **틀릴 일이 없는 쪽**을 골랐다.
 *
 * 핵심은 **언제 찍느냐**다. 노트를 끄는 동안 손가락이 움직일 때마다 찍으면
 * 되돌리기 한 번에 1픽셀씩 돌아간다. 그래서 화면은 "이제 뭔가 바꾼다" 는
 * 순간(손가락을 대는 순간)에만 알려 주고, 그때의 **직전 상태**를 쌓는다.
 */

import type { Project } from "./model/types";

const LIMIT = 60;

export class History {
  private past: string[] = [];
  private future: string[] = [];
  private pending: string | null = null;

  constructor(private getProject: () => Project) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * 바꾸기 **직전에** 부른다. 실제로 바뀌었는지는 commit 에서 판단한다.
   * 탭했다가 아무것도 안 바뀌는 경우(빈 곳을 눌렀다 뗀다든지)에 쓰레기가
   * 쌓이지 않게 하려는 것이다.
   */
  begin(): void {
    if (this.pending === null) this.pending = this.snapshot();
  }

  /** 바꾸기가 끝났다. 진짜로 달라졌을 때만 쌓는다. */
  commit(): void {
    const before = this.pending;
    this.pending = null;
    if (before === null || before === this.snapshot()) return;

    this.past.push(before);
    if (this.past.length > LIMIT) this.past.shift();
    // 되돌린 뒤에 새로 편집하면 앞으로 갈 길은 사라진다. 편집기의 상식이다.
    this.future = [];
  }

  /** begin/commit 을 한 번에. 한 방에 끝나는 변경(악기 교체 등)에 쓴다. */
  record(change: () => void): void {
    this.begin();
    change();
    this.commit();
  }

  undo(): Project | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.snapshot());
    return JSON.parse(previous) as Project;
  }

  redo(): Project | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.snapshot());
    return JSON.parse(next) as Project;
  }

  /** 파일을 새로 열었을 때처럼 이력이 의미 없어지는 경우. */
  clear(): void {
    this.past = [];
    this.future = [];
    this.pending = null;
  }

  private snapshot(): string {
    return JSON.stringify(this.getProject());
  }
}
