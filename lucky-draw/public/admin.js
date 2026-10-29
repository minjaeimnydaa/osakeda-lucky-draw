import { $, esc, api, toast, csv } from './shared.js';
let data, selected, issued;
const localInput = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0,16);
const timestamp = value => new Date(value).toLocaleString('ko-KR', { timeZone:'Asia/Seoul' });
function current() { return data.events.find(e => e.id === selected); }
async function refresh() {
  data = await api('admin-data');
  if (!data.events.some(e => e.id === selected)) selected = data.events[0]?.id;
  $('#login-panel').hidden = true; $('#dashboard').hidden = false; $('#logout').hidden = false;
  $('#event-select').innerHTML = data.events.map(e => `<option value="${esc(e.id)}">${esc(e.config.title)}${e.config.test ? ' · 테스트' : ''}</option>`).join('');
  $('#event-select').value = selected; render();
}
function render() {
  const e = current(); if (!e) return; const c = e.config;
  const winners = data.winners.filter(w => w.event_id === e.id); const stats = data.stats.filter(s => s.event_id === e.id); const codes = data.codes.filter(s => s.event_id === e.id);
  const today = new Date(Date.now() + 9*3600000).toISOString().slice(0,10);
  const metrics = [['누적 참여', stats.reduce((n,s) => n + Number(s.n),0)], ['오늘 참여', stats.filter(s => s.day === today).reduce((n,s) => n + Number(s.n),0)], ['당첨 / 전체 경품', `${winners.length} / ${c.prizes.reduce((n,p) => n+p.total,0)}`], ['미발급 당첨', winners.filter(w => !w.fulfilled).length]];
  $('#metrics').innerHTML = metrics.map(([label,n]) => `<div class="metric"><span>${label}</span><strong>${n}</strong></div>`).join('');
  $('#test-tip').hidden = !c.test;
  for (const field of ['title','subtitle','status','delivery','contact','privacy']) $(`#${field}`).value = c[field];
  $('#start').value = localInput(c.start); $('#end').value = localInput(c.end);
  $('#preview').href = `/?event=${encodeURIComponent(e.slug)}`;
  $('#event-address').textContent = `전용 주소: /?event=${e.slug}`;
  $('#prize-fields').innerHTML = c.prizes.map((p,i) => `<div class="prize-field"><strong>${i+1}등</strong><div><label for="prize-${i}-name">경품명</label><input id="prize-${i}-name" data-prize="${i}" data-field="name" value="${esc(p.name)}" required maxlength="80"></div><div><label for="prize-${i}-detail">금액 · 설명</label><input id="prize-${i}-detail" data-prize="${i}" data-field="detail" value="${esc(p.detail)}" maxlength="80"></div><div><label for="prize-${i}-total">전체 수량</label><input id="prize-${i}-total" data-prize="${i}" data-field="total" type="number" min="0" max="100000" step="1" value="${p.total}" required></div><div><label for="prize-${i}-chance">확률 (%)</label><input id="prize-${i}-chance" data-prize="${i}" data-field="chance" type="number" min="0" max="100" step="0.0001" value="${p.chance}" required></div></div>`).join('');
  $('#winner-rows').innerHTML = winners.length ? winners.map(w => `<tr><td>${esc(timestamp(w.created))}</td><td>${w.prize+1}등 · ${esc(c.prizes[w.prize].detail)}</td><td>${esc(w.email || '이메일 등록 대기')}</td><td><span class="status-chip ${w.fulfilled ? '' : 'waiting'}">${w.fulfilled ? '발급 완료' : w.email ? '발급 대기' : '수령 정보 대기'}</span></td><td>${w.email && !w.fulfilled ? `<button class="text-button" data-fulfill="${esc(w.id)}">발급 완료 처리</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">아직 당첨 내역이 없어요.</td></tr>';
  $('#code-rows').innerHTML = codes.length ? codes.map(code => `<tr><td>${esc(code.label)}</td><td>${code.active ? '사용 가능' : '사용 중지'}</td><td>${code.active ? `<button class="text-button" data-revoke="${esc(code.id)}">사용 중지</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">발급된 코드가 없어요.</td></tr>';
  $('#save-error').textContent = '';
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); e.submitter.disabled = true; $('#login-error').textContent = '';
  try { await api('login', { password:$('#password').value }); $('#password').value = ''; await refresh(); }
  catch (err) { $('#login-error').textContent = err.message; } finally { e.submitter.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('admin-logout', {}); location.reload(); } catch (err) { toast(err.message); } });
$('#event-select').addEventListener('change', e => { selected = e.target.value; issued = null; $('#issued-recovery').hidden = true; render(); });
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(t => { t.setAttribute('aria-pressed', t === b); $(`#tab-${t.dataset.tab}`).hidden = t !== b; });
}));
$('#settings-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; $('#save-error').textContent = '';
  const config = structuredClone(current().config);
  for (const field of ['title','subtitle','status','delivery','contact','privacy']) config[field] = $(`#${field}`).value;
  config.start = new Date($('#start').value + ':00+09:00').toISOString(); config.end = new Date($('#end').value + ':00+09:00').toISOString();
  document.querySelectorAll('[data-prize]').forEach(input => { config.prizes[+input.dataset.prize][input.dataset.field] = ['total','chance'].includes(input.dataset.field) ? Number(input.value) : input.value; });
  try { await api('admin-save', { id:selected, config }); await refresh(); toast('설정을 저장했어요.'); }
  catch (err) { $('#save-error').textContent = err.message; } finally { button.disabled = false; }
});
$('#clone').addEventListener('click', async e => {
  if (!confirm('현재 이벤트의 설정을 복사할까요? 참여 기록과 코드는 복사하지 않으며, 준비 중 상태로 생성됩니다.')) return;
  e.target.disabled = true;
  try { const clone = await api('admin-clone', { id:selected }); selected = clone.id; await refresh(); toast('새 이벤트를 만들었어요. 기간과 경품을 확인해 주세요.'); }
  catch (err) { toast(err.message); } finally { e.target.disabled = false; }
});
function downloadCodes() { if (issued) csv([['고객 식별값','참여 코드'], ...issued.map(c => [c.customer,c.code])], 'osakeda-customer-codes.csv'); }
$('#codes-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; $('#codes-error').textContent = '';
  try { issued = await api('admin-codes', { id:selected, customers:$('#customers').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }); downloadCodes(); $('#customers').value = ''; $('#issued-recovery').hidden = false; await refresh(); toast('코드를 발급했어요. CSV를 안전하게 보관해 주세요.'); }
  catch (err) { $('#codes-error').textContent = err.message; } finally { button.disabled = false; }
});
$('#redownload-codes').addEventListener('click', downloadCodes);
$('#export-winners').addEventListener('click', () => { const e = current(); csv([['당첨 번호','당첨 일시(한국)','등수','경품','이메일','발급 상태','발급 일시(한국)'], ...data.winners.filter(w => w.event_id === selected).map(w => [w.id,timestamp(w.created),w.prize+1,`${e.config.prizes[w.prize].name} ${e.config.prizes[w.prize].detail}`,w.email || '',w.fulfilled ? '발급 완료' : '미발급',w.fulfilled ? timestamp(w.fulfilled) : ''])], `osakeda-winners-${e.slug}.csv`); });
$('#winner-rows').addEventListener('click', async e => {
  const b = e.target.closest('[data-fulfill]'); if (!b || !confirm('실제 기프트카드 발급을 마쳤나요? 발급 완료 상태로 표시합니다.')) return;
  b.disabled = true; try { await api('admin-fulfill', { id:b.dataset.fulfill }); await refresh(); toast('발급 완료로 표시했어요.'); } catch (err) { b.disabled = false; toast(err.message); }
});
$('#code-rows').addEventListener('click', async e => {
  const b = e.target.closest('[data-revoke]'); if (!b || !confirm('이 코드를 사용 중지할까요? 해당 코드로는 참여와 이메일 등록을 할 수 없게 됩니다.')) return;
  b.disabled = true; try { await api('admin-revoke', { id:b.dataset.revoke }); await refresh(); toast('코드를 중지했어요.'); } catch (err) { b.disabled = false; toast(err.message); }
});
refresh().catch(err => { if (err.status !== 401) $('#login-error').textContent = err.message; });
