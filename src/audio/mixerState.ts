/**
 * 믹서의 "지금 상태" — 무엇이 들리고 무엇이 안 들리는가.
 *
 * 솔로를 여기 두는 이유가 있다. **솔로는 곡의 일부가 아니라 작업 중의
 * 상태다.** 저장했다 다시 열었는데 한 트랙만 들리면 사용자는 곡이 망가진 줄
 * 안다. 뮤트는 "이 트랙은 빼고 간다" 는 결정이라 저장하지만, 솔로는 "지금
 * 이것만 들어 보자" 라서 저장하지 않는다.
 *
 * 들리는지 여부를 한 곳에서만 계산한다. 재생·미리듣기·오프라인 렌더가 전부
 * 이걸 부른다 — 세 군데에 같은 규칙을 흩어 놓으면 반드시 어긋난다.
 */

import type { Project, Track } from "../model/types";
import { assignChannels } from "../model/channels";
import type { Mixer } from "./mixer";

export class MixerState {
  /** 솔로가 걸린 트랙 id. 비어 있으면 솔로가 없는 것. */
  private soloed = new Set<string>();

  get hasSolo(): boolean {
    return this.soloed.size > 0;
  }

  isSolo(track: Track): boolean {
    return this.soloed.has(track.id);
  }

  toggleSolo(track: Track): void {
    if (this.soloed.has(track.id)) this.soloed.delete(track.id);
    else this.soloed.add(track.id);
  }

  clearSolo(): void {
    this.soloed.clear();
  }

  /** 솔로가 하나라도 걸려 있으면 솔로가 아닌 트랙은 안 들린다. */
  isAudible(track: Track): boolean {
    if (track.muted) return false;
    return !this.hasSolo || this.soloed.has(track.id);
  }

  /** 프로젝트 전체를 믹서에 반영한다. 설정이 바뀔 때마다 부르면 된다. */
  apply(project: Project, mixer: Mixer): void {
    const channels = assignChannels(project);
    project.tracks.forEach((track, index) => {
      mixer.set(channels[index], {
        volume: track.volume,
        pan: track.pan,
        muted: !this.isAudible(track),
        send: track.reverbSend ?? 0,
      });
    });
  }
}
