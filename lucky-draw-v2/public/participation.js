const koreanTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const formatTime = value => `${koreanTime.format(new Date(value))}(한국 시간)`;

export function getDrawState(event, result) {
  const active = event.status === 'active' && !event.soldOut;
  const state = { active, phase: 'verify', button: '참여 코드 입력하기', disabled: false, status: '코드 확인 전', hint: '구매 후 개별 전달받은 코드로 참여할 수 있어요.', note: '고객당 하루 1회 참여 · 이벤트 기간 중 최대 1회 당첨', nextAt: null };
  if (result?.prize) {
    state.note = '당첨 내역은 같은 코드로 다시 확인할 수 있어요.';
    if (result.fulfilled) return { ...state, phase: 'fulfilled', button: '발급 내역 확인하기', status: '기프트카드 발급 완료', hint: '등록한 이메일에서 기프트카드를 확인해 주세요.' };
    if (result.claimed) return { ...state, phase: 'waiting', button: '발급 안내 확인하기', status: '이메일 등록 완료 · 발급 대기', hint: '수령 이메일이 등록되었어요. 안내된 발급 일정을 확인해 주세요.' };
    return { ...state, phase: 'claim', button: '수령 이메일 등록하기', status: '수령 이메일 등록 필요', hint: '당첨되었어요! 기프트카드를 받을 이메일을 등록해 주세요.' };
  }
  const closed = event.status === 'upcoming'
    ? { status: '오픈 예정', hint: `${formatTime(event.start)}부터 참여할 수 있어요.` }
    : event.status === 'active' && event.soldOut ? { status: '경품 소진', hint: '준비된 경품이 모두 소진되어 추첨이 마감되었어요.' }
    : ({
      paused: { status: '일시 중지', hint: '이벤트가 잠시 중지되었어요. 재개 후 다시 참여해 주세요.' },
      ended: { status: '이벤트 종료', hint: '이벤트가 종료되어 새로 참여할 수 없어요.' }
    }[event.status] || { status: '이벤트 준비 중', hint: '이벤트를 준비하고 있어요. 공개 후 다시 방문해 주세요.' });
  if (result) {
    const next = (Math.floor((Date.parse(event.now) + 9 * 3600000) / 86400000) + 1) * 86400000 - 9 * 3600000;
    const nextAt = active && Number.isFinite(next) && next < Date.parse(event.end) ? new Date(next).toISOString() : null;
    return { ...state, phase: 'done', button: '오늘의 결과 확인하기', status: active ? '오늘 참여 완료' : closed.status,
      hint: nextAt ? `오늘은 아쉽지만, ${formatTime(nextAt)}부터 다시 참여할 수 있어요.` : active ? '이번 이벤트의 마지막 참여를 마쳤어요. 함께해 주셔서 고마워요.' : closed.hint,
      note: '같은 코드로 참여 결과를 다시 확인할 수 있어요.', nextAt };
  }
  if (!active) return { ...state, ...closed, phase: 'closed', button: event.identified ? closed.status : '참여 내역 확인하기', disabled: !!event.identified, note: '기존 참여 코드를 입력하면 이전 결과를 확인할 수 있어요.' };
  return event.identified ? { ...state, phase: 'ready', button: '지금 뽑기', status: '오늘 참여 가능', hint: '버튼을 누르면 집게가 멈추고 추첨을 시작해요.' } : state;
}
