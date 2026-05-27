// ==========================================
// 설정
// ==========================================
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVG7qHLYUmPSUdKcuQExcwskxE2Pi76S5Yz42B7EyTAZZ56dUgBBFMGRl_L46iCJTdmK6trX6Z_M7E/pub?gid=185556541&single=true&output=csv';
const CACHE_KEY = 'telebriefing_v3_data';
const CACHE_TIME_KEY = 'telebriefing_v3_time';
const CACHE_TTL = 1000 * 60 * 30; // 30분

// 카테고리 정의 (코드 → 표시명)
const CATEGORIES = [
  { code: 'all',           label: '전체' },
  { code: 'public',        label: '주요기관' },
  { code: 'education',     label: '교육기관' },
  { code: 'religion',      label: '종교·NGO' },
  { code: 'bank',          label: '은행·법인' },
  { code: 'textile',       label: '봉제' },
  { code: 'construction',  label: '건설·전기' },
  { code: 'realestate',    label: '부동산' },
  { code: 'farm',          label: '농장·농업' },
  { code: 'logistics',     label: '차량·물류' },
  { code: 'food_dist',     label: '식품·유통' },
  { code: 'medical',       label: '병원·약국' },
  { code: 'beauty',        label: '미용·마사지' },
  { code: 'travel',        label: '여행·골프' },
  { code: 'entertainment', label: '노래방' },
  { code: 'restaurant',    label: '식당·치킨' },
  { code: 'service',       label: '기타서비스' },
  { code: 'club',          label: '동호회' },
  { code: 'siemreap',      label: '시엠립' },
  { code: 'media',         label: '언론·미디어' },
  { code: 'ngo',           label: 'NGO·개발' },
];

// ==========================================
// 초성 검색 유틸리티
// ==========================================
const CHOSUNG_LIST = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function getChosung(str) {
  let result = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      result += CHOSUNG_LIST[Math.floor((code - 0xAC00) / 588)];
    } else {
      result += ch;
    }
  }
  return result;
}

function isChosungOnly(str) {
  return [...str].every(c => CHOSUNG_LIST.includes(c));
}

function matchSearch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = (target || '').toLowerCase();
  if (t.includes(q)) return true;
  if (isChosungOnly(query)) {
    return getChosung(target).includes(query);
  }
  return false;
}

// ==========================================
// 텔레그램 SDK 초기화
// ==========================================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

function haptic() {
  tg?.HapticFeedback?.impactOccurred('light');
}

// ==========================================
// 상태
// ==========================================
let allData = [];
let currentCategory = 'all';
let currentQuery = '';

// ==========================================
// 카테고리 드롭다운 렌더링
// ==========================================
function renderCategoryTabs() {
  const usedCodes = new Set(allData.map(r => r.category?.trim()).filter(Boolean));
  const cats = CATEGORIES.filter(c => c.code === 'all' || usedCodes.has(c.code));

  const select = document.getElementById('categorySelect');
  select.innerHTML = cats.map(cat => `
    <option value="${cat.code}" ${currentCategory === cat.code ? 'selected' : ''}>
      ${cat.code === 'all' ? '📋 전체 보기' : cat.label}
    </option>
  `).join('');

  select.addEventListener('change', () => {
    haptic();
    selectCategory(select.value);
  });
}

function selectCategory(code) {
  currentCategory = code;
  const select = document.getElementById('categorySelect');
  if (select) select.value = code;
  renderList();
}

// ==========================================
// 같은 이름의 항목을 하나의 카드로 그룹핑
// ==========================================
function groupByName(rows) {
  const map = new Map();
  rows.forEach(row => {
    const key = `${row.name?.trim()}__${row.category?.trim()}`;
    if (!map.has(key)) {
      map.set(key, { ...row, phones: [] });
    }
    const phone = (row.phone || '').trim();
    if (phone && !map.get(key).phones.includes(phone)) {
      map.get(key).phones.push(phone);
    }
  });
  return Array.from(map.values());
}

// ==========================================
// 연락처 카드 렌더링
// ==========================================
function renderList() {
  const list = document.getElementById('contactList');
  const empty = document.getElementById('emptyState');
  const countEl = document.getElementById('resultCount');

  let filtered = allData;

  if (currentCategory !== 'all') {
    filtered = filtered.filter(r => r.category?.trim() === currentCategory);
  }

  if (currentQuery) {
    filtered = filtered.filter(r =>
      matchSearch(currentQuery, r.name) ||
      matchSearch(currentQuery, r.description) ||
      (r.phone || '').replace(/[\s-]/g, '').includes(currentQuery.replace(/[\s-]/g, ''))
    );
  }

  // 이름별로 그룹핑 (같은 기관 = 카드 1개)
  const grouped = groupByName(filtered);

  // 결과 카운트
  countEl.textContent = grouped.length > 0 ? `총 ${grouped.length}개` : '';

  if (grouped.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  list.classList.remove('hidden');
  empty.classList.add('hidden');

  list.innerHTML = grouped.map(item => {
    const hasMap = (item.map_url || '').trim().length > 0;
    const catInfo = CATEGORIES.find(c => c.code === item.category?.trim());
    const catLabel = catInfo ? catInfo.label : (item.category || '');

    // 전화번호 여러 개일 때 각각 버튼 생성
    const phoneButtons = item.phones.map((phone, idx) => {
      const telPhone = phone.replace(/[\s-]/g, '');
      return `
        <div class="flex items-center justify-between mt-${idx === 0 ? '1.5' : '1'} gap-2">
          <span class="phone-number-link text-xs font-medium"
                onclick="copyPhone('${telPhone}', '${escapeHtml(phone)}', '${escapeHtml(item.name)}')">
            ${escapeHtml(phone)}
          </span>
          <button class="action-btn call-btn flex items-center justify-center w-8 h-8 rounded-xl text-base flex-shrink-0"
             onclick="copyPhone('${telPhone}', '${escapeHtml(phone)}', '${escapeHtml(item.name)}')">
            📞
          </button>
        </div>
      `;
    }).join('');

    return `
    <div class="contact-card rounded-2xl p-3.5">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <p class="font-semibold text-sm leading-snug" style="color: var(--tg-theme-text-color)">${escapeHtml(item.name)}</p>
            ${catLabel && currentCategory === 'all' ? `<span class="cat-badge text-xs px-1.5 py-0.5 rounded-md">${catLabel}</span>` : ''}
          </div>
          ${item.description ? `<p class="text-xs mt-0.5" style="color: var(--tg-theme-hint-color)">${escapeHtml(item.description)}</p>` : ''}
          ${phoneButtons}
        </div>
        ${hasMap ? `
          <a href="${escapeHtml(item.map_url)}" target="_blank" rel="noopener"
             class="action-btn map-btn flex items-center justify-center w-10 h-10 rounded-xl text-lg flex-shrink-0 mt-0.5">
            📍
          </a>
        ` : ''}
      </div>
    </div>
    `;
  }).join('');
}

// ==========================================
// 바텀시트
// ==========================================
let _bsTelPhone = '';
let _bsDisplayPhone = '';

function copyPhone(telPhone, displayPhone, name) {
  haptic();
  _bsTelPhone = telPhone;
  _bsDisplayPhone = displayPhone || telPhone;

  document.getElementById('bsName').textContent = name || '';
  document.getElementById('bsPhone').textContent = _bsDisplayPhone;

  // 진짜 tel: 링크로 href 설정 (OS가 직접 처리하도록)
  document.getElementById('bsCallBtn').href = 'tel:' + telPhone;

  document.getElementById('bottomSheetOverlay').classList.add('active');
  document.getElementById('bottomSheet').classList.add('active');
}

function closeBottomSheet() {
  document.getElementById('bottomSheetOverlay').classList.remove('active');
  document.getElementById('bottomSheet').classList.remove('active');
}

// <a> 태그가 OS에 직접 tel: 전달, 햅틱만 트리거
function bottomSheetCallTrack() {
  haptic();
  // 시트는 살짝 뒤에 닫기 (네이티브 동작 방해 X)
  setTimeout(closeBottomSheet, 300);
  // return true로 기본 동작(href 이동) 허용
}

function bottomSheetCopy() {
  haptic();
  closeBottomSheet();
  const text = _bsDisplayPhone;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(text));
  } else {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); showToast(text); } catch (e) {}
    document.body.removeChild(el);
  }
}

function showToast(phone, success = true) {
  // 기존 토스트 제거
  const old = document.getElementById('copyToast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'copyToast';
  toast.className = 'copy-toast';
  toast.innerHTML = success
    ? `📋 <strong>${phone}</strong> 복사됨!`
    : `📋 ${phone}`;
  document.body.appendChild(toast);

  // 애니메이션
  requestAnimationFrame(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  });
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================
// 데이터 로드 (Stale-While-Revalidate)
// ==========================================
async function loadData() {
  const loading = document.getElementById('loading');
  const errorState = document.getElementById('errorState');
  const list = document.getElementById('contactList');

  loading.classList.remove('hidden');
  errorState.classList.add('hidden');
  list.classList.add('hidden');

  // 1) 캐시에서 즉시 표시
  const cached = localStorage.getItem(CACHE_KEY);
  const cachedTime = parseInt(localStorage.getItem(CACHE_TIME_KEY) || '0');

  if (cached) {
    try {
      allData = JSON.parse(cached);
      if (allData.length > 0) {
        loading.classList.add('hidden');
        renderCategoryTabs();
        renderList();
      }
    } catch (e) {
      console.warn('캐시 파싱 오류:', e);
    }
  }

  // 2) 백그라운드에서 최신 데이터 fetch
  try {
    const res = await fetch(SHEET_URL + '&t=' + Date.now()); // 캐시 우회
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      transform: v => (v || '').trim(),
    });

    const fresh = result.data.filter(r => r.name && r.phone);

    localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
    localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));

    allData = fresh;
    loading.classList.add('hidden');
    renderCategoryTabs();
    renderList();

  } catch (err) {
    console.error('데이터 로드 실패:', err);
    loading.classList.add('hidden');

    if (allData.length === 0) {
      // 캐시도 없으면 오류 화면
      errorState.classList.remove('hidden');
    }
    // 캐시가 있으면 기존 데이터 유지 (조용히 실패)
  }
}

// ==========================================
// 검색 핸들러
// ==========================================
const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearSearch');

searchInput.addEventListener('input', e => {
  currentQuery = e.target.value.trim();
  clearBtn.classList.toggle('hidden', currentQuery.length === 0);
  renderList();
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  currentQuery = '';
  clearBtn.classList.add('hidden');
  searchInput.focus();
  renderList();
});

// ==========================================
// 키보드 내리기 (검색창 외 다른 곳 탭 시)
// ==========================================
document.addEventListener('touchstart', (e) => {
  if (!e.target.closest('#searchInput') && !e.target.closest('#clearSearch')) {
    searchInput.blur();
  }
}, { passive: true });

// ==========================================
// 시작
// ==========================================
loadData();
