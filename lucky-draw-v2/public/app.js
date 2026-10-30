import { $, esc, api, toast, formatDate, download } from './shared.js';
import { getDrawState } from './participation.js';
const slug = new URLSearchParams(location.search).get('event') || 'lucky-days';
let event; let result; let busy = false; let storyBlob; let storyUrl; let loadVersion = 0;
let needsSync = false; let syncBusy = false; let enterBusy = false; let enterConfirmed = false; let claimBusy = false; let claimDraftFor = null;
const actionPending = () => busy || enterBusy || claimBusy || syncBusy;
const codeDialog = $('#code-dialog'); const resultDialog = $('#result-dialog');
const machine = $('#machine'); const travel = $('#claw-travel');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const smallScreen = matchMedia('(max-width: 780px)');
let actionOnscreen = true;
function updateDock() {
  const primary = $('#enter-button');
  $('#mobile-dock').hidden = !event || actionOnscreen || !smallScreen.matches || (primary.disabled && !actionPending()) || !!document.querySelector('dialog[open]');
  $('#dock-button').textContent = primary.textContent;
  $('#dock-button').disabled = primary.disabled;
  $('#dock-status').textContent = $('#board-status').textContent;
}
smallScreen.addEventListener('change', updateDock);
if (typeof IntersectionObserver !== 'undefined') {
  const observer = new IntersectionObserver(([entry]) => { actionOnscreen = entry.intersectionRatio >= .75; updateDock(); }, { threshold: .75 });
  observer.observe($('#enter-button'));
}
$('#dock-button').addEventListener('click', () => $('#enter-button').click());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', updateDock));
function openCode() { if (actionPending()) return; codeDialog.showModal(); updateDock(); }
function connectionNote(message) { $('#connection-message').textContent = message; $('#connection-note').hidden = false; }
const tickets = [[12,211,13],[67,204,27],[214,211,-19],[-28,265,-20],[40,280,18],[201,276,-16],[278,250,28],[102,298,-10],[126,245,-10]];
$('#cards').innerHTML = tickets.map(([x,y,angle],i) => `<g class="machine-ticket" data-card="${i+1}" transform="translate(${x} ${y}) rotate(${angle} 57 32)"><use href="#lucky-ticket"/></g>`).join('');
let idleMotion; let drawMotions = [];
function updateMachine() {
  if (busy) return;
  machine.classList.toggle('is-complete', !!result);
  machine.classList.remove('is-lifting');
  document.querySelectorAll('.machine-ticket').forEach(t => t.classList.toggle('is-picked', !!result && +t.dataset.card === result.card));
  const canMove = !enterBusy && !needsSync && !result && event?.status === 'active' && !event.soldOut && !reducedMotion.matches;
  if (!canMove) { idleMotion?.cancel(); idleMotion = null; }
  else if (!idleMotion) idleMotion = travel.animate([{ transform:'translateX(-110px)' }, { transform:'translateX(110px)' }], { duration:2600, direction:'alternate', iterations:Infinity, easing:'ease-in-out' });
}
reducedMotion.addEventListener('change', updateMachine);
async function move(element, frames, duration) {
  const motion = element.animate(frames, { duration:reducedMotion.matches ? 0 : duration, fill:'forwards', easing:'cubic-bezier(.4,0,.2,1)' });
  drawMotions.push(motion); await motion.finished;
}
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => { b.closest('dialog').close(); updateDock(); }));
async function load(committedResult = null) {
  const version = ++loadVersion;
  const fresh = await api('event', undefined, slug);
  if (version !== loadVersion) return;
  event = fresh;
  result = committedResult && event.result?.id !== committedResult.id ? committedResult : event.result || committedResult;
  needsSync = false; $('#connection-note').hidden = true;
  document.title = `${event.title} · 오사케다`;
  $('#event-title').textContent = event.title;
  document.querySelector('[aria-label="오사케다 이벤트 홈"]').href = `/?event=${encodeURIComponent(slug)}`;
  $('#subtitle').textContent = event.subtitle;
  $('#period').textContent = `${formatDate(event.start)} — ${formatDate(new Date(Date.parse(event.end) - 1))}`;
  $('#test-banner').hidden = !event.test;
  const remaining = event.prizes.reduce((sum, p) => sum + p.remaining, 0);
  const available = event.prizes.find(p => p.remaining > 0);
  $('#draw-benefit').textContent = available ? `${available.rank}등 ${available.detail} · 남은 경품 ${remaining}개` : '준비된 경품이 모두 소진되었어요.';
  $('#prizes').innerHTML = event.prizes.map(p => `<article class="prize-item${p.remaining === 0 ? ' is-exhausted' : ''}"><span class="rank quiet-tag">${p.rank}등</span><div class="prize-symbol" aria-hidden="true"><img src="/osakeda-logo.avif" alt="" width="200" height="70"><span>GIFT CARD</span></div><div class="prize-copy"><h3>${esc(p.name)}</h3><p class="prize-value">${esc(p.detail)}</p></div><span class="quantity">${p.remaining === 0 ? '수량 소진' : `총 ${p.total}명`}</span></article>`).join('');
  $('#delivery-notice').textContent = event.delivery || '경품 발급 일정은 이벤트 공개 시 안내됩니다.';
  $('#privacy-notice').textContent = event.privacy || '개인정보 수집 안내가 준비 중입니다.';
  $('#claim-privacy').textContent = event.privacy || '개인정보 수집 안내가 준비 중입니다.';
  $('#contact-notice').hidden = !event.contact; $('#contact-notice').textContent = `문의: ${event.contact}`;
  $('#code-contact').hidden = !event.contact; $('#code-contact').textContent = `문의: ${event.contact}`;
  updateBoard();
}
function updateBoard() {
  const state = getDrawState(event, result); const active = state.active;
  const states = { draft:'이벤트 준비 중', paused:'잠시 쉬어가고 있어요', upcoming:'곧 행운이 찾아옵니다', ended:'이벤트가 마감되었어요' };
  $('#event-status').textContent = event.status === 'active' ? event.soldOut ? '경품 소진' : '진행 중' : ({draft:'준비 중', paused:'일시 중지', upcoming:'오픈 예정', ended:'종료'})[event.status] || '준비 중';
  $('#event-status').classList.toggle('inactive', !active);
  machine.setAttribute('aria-busy', String(busy));
  const stage = result ? 2 : event.identified ? 1 : 0;
  ['step-code','step-pick','step-result'].forEach((id,i) => { const step = $(`#${id}`); step.classList.toggle('completed', i < stage); if (i === stage) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current'); });
  $('#day-pill').textContent = event.status === 'active' ? `${Math.min(event.day, event.days)}일차 / ${event.days}일간의 행운` : (states[event.status] || '이벤트 준비 중');
  $('#change-code').hidden = !event.identified;
  $('#change-code').disabled = actionPending();
  $('#retry-load').disabled = actionPending();
  for (const id of ['share','copy-link','save-story','result-share','result-story','download-story']) $(`#${id}`).disabled = actionPending();
  const button = $('#enter-button'); button.disabled = state.disabled || actionPending();
  button.textContent = state.button;
  $('#board-status').textContent = state.status; $('#board-hint').textContent = state.hint;
  $('.draw-feedback').dataset.phase = state.phase;
  if (needsSync) { button.disabled = actionPending(); button.textContent = '참여 상태 다시 확인'; $('#board-status').textContent = '참여 상태 확인 필요'; $('#board-hint').textContent = '연결이 지연되고 있어요. 저장된 참여 상태를 먼저 확인해 주세요.'; }
  if (busy) { button.disabled = true; button.textContent = '행운을 뽑고 있어요…'; $('#board-status').textContent = '두근두근, 추첨 중'; }
  if (claimBusy) { button.disabled = true; button.textContent = '이메일을 등록하고 있어요…'; }
  if (enterBusy) { button.disabled = true; button.textContent = '참여 코드를 확인하고 있어요…'; $('#board-status').textContent = '코드 확인 중'; }
  $('.draw-note').textContent = state.note;
  $('#step-result').innerHTML = `<span>03</span> ${state.phase === 'claim' ? '이메일 등록' : '결과 확인'}`;
  updateMachine(); updateDock();
}
async function retryLoad() {
  if (actionPending()) return;
  syncBusy = true; $('#retry-load').disabled = true; if (event) updateBoard();
  try { await load(result?.prize ? result : null); toast('참여 상태를 다시 확인했어요.'); }
  catch (err) { connectionNote(err.message); }
  finally { syncBusy = false; $('#retry-load').disabled = false; if (event) updateBoard(); }
}
$('#retry-load').addEventListener('click', retryLoad);
$('#enter-button').addEventListener('click', () => { if (actionPending()) return; if (!event || needsSync) { retryLoad(); return; } if (result) showResult(); else if (event.identified && event.status === 'active' && !event.soldOut) pick(); else openCode(); });
$('#change-code').addEventListener('click', openCode);
$('#code-input').addEventListener('input', () => { if (enterBusy) return; enterConfirmed = false; $('#code-error').textContent = ''; $('#code-input').removeAttribute('aria-invalid'); $('#code-form button[type="submit"]').textContent = '확인하고 참여하기'; });
$('#code-form').addEventListener('submit', async e => {
  e.preventDefault(); if (actionPending()) return; enterBusy = true; ++loadVersion; const button = e.submitter || $('#code-form button[type="submit"]'); button.disabled = true; button.textContent = enterConfirmed ? '참여 상태를 확인하고 있어요…' : '코드를 확인하고 있어요…'; $('#code-input').disabled = true; $('#code-form').setAttribute('aria-busy', 'true'); $('#code-error').textContent = ''; if (event) updateBoard();
  try {
    if (!enterConfirmed) { await api('enter', { code:$('#code-input').value.trim().toUpperCase() }, slug); enterConfirmed = true; needsSync = true; result = null; }
    await load(); enterConfirmed = false; codeDialog.close(); $('#code-input').value = ''; $('#code-input').removeAttribute('aria-invalid');
    if (result?.id !== claimDraftFor) { $('#email').value = ''; $('#consent').checked = false; }
    claimDraftFor = null;
    if (result) showResult(); else { toast('코드 확인 완료! 이제 행운을 뽑아보세요.'); $('#enter-button').focus({ preventScroll:true }); }
  } catch (err) {
    if (enterConfirmed) { $('#code-error').textContent = '코드는 확인됐어요. 다시 누르면 참여 상태만 확인해요.'; connectionNote('코드는 확인됐지만 참여 상태를 아직 불러오지 못했어요.'); }
    else { $('#code-error').textContent = err.message; if (err.status === 400 || err.status === 401) $('#code-input').setAttribute('aria-invalid', 'true'); else $('#code-input').removeAttribute('aria-invalid'); if (err.uncertain) { needsSync = true; connectionNote(err.message); } }
  } finally { enterBusy = false; $('#code-input').disabled = false; $('#code-form').setAttribute('aria-busy', 'false'); button.disabled = false; button.textContent = enterConfirmed ? '참여 상태 다시 확인' : '확인하고 참여하기'; if (event) updateBoard(); }
});
async function pick() {
  if (actionPending() || needsSync || result || !event?.identified || event.status !== 'active' || event.soldOut) return;
  const x = new DOMMatrix(getComputedStyle(travel).transform).m41;
  const card = Math.max(1, Math.min(9, Math.floor((x+110)/220*9)+1));
  busy = true; ++loadVersion; updateBoard(); idleMotion?.cancel(); idleMotion = null;
  const box = machine.getBoundingClientRect();
  if (box.top < 16 || box.bottom > innerHeight-16) machine.scrollIntoView({ block:'center', behavior:reducedMotion.matches ? 'instant' : 'smooth' });
  // Start the server request immediately; never assign a prize to a visible ticket.
  let committedResult;
  const request = api('draw', { card }, slug).then(answer => { committedResult = answer; return { answer }; }, error => ({ error }));
  $('#board-hint').textContent = '집게가 당신의 행운을 만나러 가요.';
  try {
    await move(travel, [{ transform:`translateX(${x}px)` }], 0);
    await Promise.all([
      move($('#claw-drop'), [{ transform:'translateY(0)' }, { transform:'translateY(90px)' }], 800),
      move($('#claw-cable'), [{ transform:'scaleY(1)' }, { transform:'scaleY(2.40625)' }], 800)
    ]);
    const { answer, error } = await request;
    if (error) throw error;
    // A second tab may have drawn first; follow the server's saved ticket index.
    const target = Math.max(-110, Math.min(110, tickets[answer.card-1][0]+57-180));
    await move(travel, [{ transform:`translateX(${x}px)` }, { transform:`translateX(${target}px)` }], 220);
    machine.classList.add('is-lifting');
    document.querySelector(`[data-card="${answer.card}"]`).classList.add('is-picked');
    $('#board-hint').textContent = '뽑았어요! 이제 결과를 확인해 볼까요?';
    await move($('#claw-drop'), [{ transform:'translateY(90px)' }], 240);
    await Promise.all([
      move($('#claw-drop'), [{ transform:'translateY(90px)' }, { transform:'translateY(0)' }], 850),
      move($('#claw-cable'), [{ transform:'scaleY(2.40625)' }, { transform:'scaleY(1)' }], 850)
    ]);
    await move(travel, [{ transform:`translateX(${target}px)` }, { transform:'translateX(0)' }], 350);
    result = answer;
    try { await load(answer); } catch { /* The committed result remains available if refreshing fails. */ }
    showResult();
  } catch (err) {
    // Even if motion stops, settle the request before allowing another attempt.
    const outcome = await request;
    const failure = outcome.error || err;
    if (committedResult) {
      result = committedResult;
      try { await load(committedResult); } catch {}
      showResult();
    } else {
      toast(failure.message);
      try { await load(); if (result) showResult(); } catch { if (failure.uncertain) { needsSync = true; connectionNote('추첨 요청이 전달됐을 수 있어요. 재참여 전에 저장된 결과를 확인해 주세요.'); } }
    }
  } finally {
    drawMotions.forEach(m => m.cancel()); drawMotions = [];
    busy = false; updateBoard();
  }
}
function showResult() {
  if (!result) return;
  const win = !!result.prize;
  $('#result-icon').textContent = win ? '✓' : '↗';
  $('#result-eyebrow').textContent = win ? 'A LITTLE LUCK FOUND YOU' : 'THANK YOU FOR PLAYING';
  $('#result-title').textContent = win ? `${result.prize.rank}등 당첨! 행운이 찾아왔어요.` : `꽝(${result.day}일차)`;
  $('#result-description').textContent = win ? event.delivery || '기프트카드를 받을 이메일을 남겨주세요.' : getDrawState(event, result).hint;
  $('#result-prize').hidden = !win; $('#result-prize').textContent = win ? `${result.prize.name} ${result.prize.detail}` : '';
  $('#claim-form').hidden = !win || result.claimed;
  $('#claim-success').hidden = !win || !result.claimed;
  $('#claim-success').textContent = result.fulfilled ? `${result.email} 주소로 경품 발급이 완료되었어요.` : `${result.email || ''}\n수령 이메일이 등록되었어요. 안내된 일정에 따라 발급해 드릴게요.`;
  $('#claim-error').textContent = '';
  $('#reverify-code').hidden = true;
  $('#result-dismiss').hidden = win && !result.claimed;
  $('#result-actions').hidden = win && !result.claimed;
  if (!resultDialog.open) resultDialog.showModal();
  updateDock();
}
$('#result-dismiss').addEventListener('click', () => { resultDialog.close(); updateDock(); });
$('#reverify-code').addEventListener('click', () => { if (actionPending()) return; claimDraftFor = result?.id; resultDialog.close(); openCode(); });
$('#claim-form').addEventListener('submit', async e => {
  e.preventDefault(); if (actionPending()) return; claimBusy = true; const button = e.submitter; button.disabled = true; $('#claim-error').textContent = ''; updateBoard();
  try {
    await api('claim', { email:$('#email').value, consent:$('#consent').checked }, slug);
    result = { ...result, claimed:true, email:null };
    try { await load(result); } catch { connectionNote('이메일 등록은 완료됐어요. 등록 주소는 상태를 다시 확인하면 볼 수 있어요.'); updateBoard(); }
    $('#email').value = ''; $('#consent').checked = false; showResult();
  } catch (err) {
    $('#claim-error').textContent = err.message;
    if (err.status === 401) $('#reverify-code').hidden = false;
    else if (err.uncertain) connectionNote('이메일 등록 여부를 바로 확인하지 못했어요. 상태를 다시 확인해 주세요.');
  } finally { claimBusy = false; button.disabled = false; updateBoard(); }
});
function shareUrl() { const url = new URL('/', location.origin); url.searchParams.set('event', slug); return url.href; }
async function copy() {
  if (actionPending()) return;
  try { await navigator.clipboard.writeText(shareUrl()); toast('이벤트 링크를 복사했어요.'); }
  catch { toast(`이 주소를 복사해 주세요: ${shareUrl()}`); }
}
async function share() {
  if (actionPending()) return;
  const data = { title: event?.title || '오사케다 럭키 드로우', text:'매일 한 번, 당신의 행운을 뽑아보세요. 구매 고객 전용 이벤트', url:shareUrl() };
  if (navigator.share) { try { await navigator.share(data); } catch (err) { if (err.name !== 'AbortError') await copy(); } } else await copy();
}
async function saveStory(withResult = false) {
  if (!event || actionPending()) return;
  const logo = document.querySelector('.wordmark img');
  await Promise.all([logo.decode(), document.fonts.ready]);
  if (actionPending()) return;
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0,0,1080,1920);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(70,70,940,1780,54); ctx.fill();
  ctx.drawImage(logo,380,106,320,112);
  ctx.textAlign = 'center'; ctx.font = '700 24px "Malgun Gothic",sans-serif'; ctx.fillStyle = '#6b7684'; ctx.fillText('오사케다 럭키 드로우',540,280);
  ctx.font = 'bold 65px "Malgun Gothic",sans-serif'; ctx.fillStyle = '#191f28';
  const headline = withResult && result ? result.prize ? `${result.prize.rank}등 당첨!` : '오늘의 도전 완료!' : '당신의 행운을 뽑아보세요';
  ctx.fillText(headline,540,490,920);
  ctx.fillStyle = '#f2f6fc'; ctx.beginPath(); ctx.roundRect(230,650,620,650,42); ctx.fill();
  ctx.save(); ctx.translate(340,718); ctx.scale(4,4);
  ctx.fillStyle = '#8cb2ed'; ctx.fill(new Path2D('M19 4h10q2 0 2 2v5q0 2-2 2v18q0 4 4 7l6 4q5 4 5 11v35q0 8-8 8H12q-8 0-8-8V53q0-7 5-11l6-4q4-3 4-7V13q-2 0-2-2V6q0-2 2-2Z'));
  ctx.translate(55,62); ctx.scale(.7,.7); ctx.fillStyle = '#bbd2f6'; ctx.fill(new Path2D('M7 12q25 6 50 0l-5 21q-2 11-13 13v4H25v-4q-11-2-13-13Z')); ctx.restore();
  ctx.fillStyle = '#1b64da'; ctx.font = 'bold 23px "Malgun Gothic",sans-serif'; ctx.fillText('하루 한 번, 기프트카드에 도전해요',540,1215);
  ctx.fillStyle = '#191f28'; ctx.font = 'bold 33px "Malgun Gothic",sans-serif';
  const message = withResult && result?.prize ? `${result.prize.name} ${result.prize.detail}` : event.title;
  ctx.fillText(message,540,1440,880); ctx.font = '27px "Malgun Gothic",sans-serif'; ctx.fillStyle = '#6b7684'; ctx.fillText(`${formatDate(event.start)} — ${formatDate(new Date(Date.parse(event.end) - 1))}`,540,1510);
  ctx.font = '26px "Malgun Gothic",sans-serif'; ctx.fillText('구매 고객 전용 · 하루 한 번 참여',540,1640);
  if (event.test) { ctx.fillStyle = '#ad453b'; ctx.fillText('테스트 이미지 · 실제 경품 지급 없음',540,1720); }
  ctx.fillStyle = '#777d71'; ctx.font = '22px Arial'; ctx.fillText(new URL(shareUrl()).host,540,1830,950);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (actionPending()) return;
  if (!blob) return toast('이미지를 만들지 못했어요. 다시 시도해 주세요.');
  storyBlob = blob;
  if (storyUrl) URL.revokeObjectURL(storyUrl);
  storyUrl = URL.createObjectURL(blob); $('#story-preview').src = storyUrl;
  $('#story-preview').alt = `${headline} · ${message} · 오사케다 이벤트 공유 이미지`;
  $('#story-dialog').showModal();
  updateDock();
}
$('#share').addEventListener('click', share); $('#result-share').addEventListener('click', share); $('#copy-link').addEventListener('click', copy);
$('#save-story').addEventListener('click', () => saveStory().catch(() => toast('이미지를 만들지 못했어요. 다시 시도해 주세요.'))); $('#result-story').addEventListener('click', () => saveStory(true).catch(() => toast('이미지를 만들지 못했어요. 다시 시도해 주세요.')));
$('#download-story').addEventListener('click', () => { if (storyBlob && !actionPending()) download(storyBlob, 'osakeda-lucky-story.png'); });
load().catch(err => { $('#period').textContent = '일정을 불러오지 못했어요'; $('#enter-button').textContent = '다시 불러오기'; $('#enter-button').disabled = false; $('#board-hint').textContent = err.message; connectionNote(err.message); });
// Refresh participation status after midnight, tab restoration, or returning from Instagram.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !actionPending() && !document.querySelector('dialog[open]')) load().catch(() => {}); });
setInterval(() => { if (event && !actionPending() && !document.hidden && !document.querySelector('dialog[open]')) load().catch(() => {}); }, 60000);
