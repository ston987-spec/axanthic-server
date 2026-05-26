const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 환경변수에서 토큰 읽기
const FEEDLE_TOKEN = process.env.FEEDLE_TOKEN || '';
const FEEDLE_ANON_KEY = process.env.FEEDLE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycGJ1Y3pyZ2ZnZmNzd3hiZWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE4NTY1MDEsImV4cCI6MjA1NzQzMjUwMX0.Wd7wCYM9eTJgpHHZUFxQfzCENfIJRkl67MBxQUHGC_k';
const FEEDLE_SUPABASE_URL = 'https://yrpbuczrgfgfcswxbeff.supabase.co';
const NAVER_COOKIE = process.env.NAVER_COOKIE || '';

// ── 피들 아잔틱 개체 검색 ──
app.get('/api/feedle', async (req, res) => {
  try {
    const results = [];
    let page = 0;
    const PAGE_SIZE = 100;

    while (true) {
      const url = `${FEEDLE_SUPABASE_URL}/rest/v1/pets?select=id,name,traits,price,images,region,seller_name,sex,size,status,created_at&order=created_at.desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;

      const r = await fetch(url, {
        headers: {
          'apikey': FEEDLE_ANON_KEY,
          'Authorization': `Bearer ${FEEDLE_TOKEN}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact'
        }
      });

      if (!r.ok) {
        console.error('Feedle API error:', r.status, await r.text());
        break;
      }

      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) break;

      // 아잔틱 필터링
      const axanthic = data.filter(p => {
        const name = (p.name || '').toLowerCase();
        const traits = Array.isArray(p.traits) ? p.traits.join(' ').toLowerCase() : (p.traits || '').toLowerCase();
        return name.includes('아잔틱') || name.includes('axanthic') || name.includes('잔틱') ||
               traits.includes('아잔틱') || traits.includes('axanthic');
      });

      for (const pet of axanthic) {
        if (!pet.price || pet.price <= 0) continue;
        if (pet.status === 'sold') continue;

        // 이미지 URL 구성
        let imgUrl = null;
        if (pet.images && pet.images.length > 0) {
          const imgPath = pet.images[0];
          imgUrl = imgPath.startsWith('http')
            ? imgPath
            : `https://yrpbuczrgfgfcswxbeff.supabase.co/storage/v1/object/public/${imgPath}`;
        }

        results.push({
          id: pet.id,
          name: pet.name || '아잔틱',
          price: pet.price,
          priceDisplay: pet.price.toLocaleString('ko-KR') + '원',
          region: pet.region || '',
          seller: pet.seller_name || '',
          sex: pet.sex || '',
          size: pet.size || '',
          img: imgUrl,
          url: `https://www.feedle.me/pet/${pet.id}`,
          src: 'feedle',
          createdAt: pet.created_at
        });
      }

      if (data.length < PAGE_SIZE) break;
      page++;
      if (page > 20) break; // 안전장치
    }

    console.log(`피들 아잔틱 ${results.length}개 발견`);
    res.json({ success: true, count: results.length, data: results });

  } catch (e) {
    console.error('피들 오류:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 파사모 아잔틱 게시글 검색 ──
app.get('/api/pasamo', async (req, res) => {
  try {
    const results = [];
    const keywords = ['아잔틱', 'axanthic'];

    for (const kw of keywords) {
      for (let page = 1; page <= 5; page++) {
        const url = `https://cafe.naver.com/ArticleSearchList.nhn?search.clubid=10421985&search.searchdate=all&search.searchBy=0&search.query=${encodeURIComponent(kw)}&search.page=${page}`;

        const r = await fetch(url, {
          headers: {
            'Cookie': NAVER_COOKIE,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://cafe.naver.com/reptilia'
          }
        });

        if (!r.ok) break;
        const html = await r.text();
        const $ = cheerio.load(html);

        const articles = [];
        $('.article-board tbody tr, .board-list tbody tr').each((i, el) => {
          const titleEl = $(el).find('a.article, .td_article a').first();
          const title = titleEl.text().trim();
          if (!title) return;
          if (!/(아잔틱|axanthic)/i.test(title)) return;

          let href = titleEl.attr('href') || '';
          const articleMatch = href.match(/articleid=(\d+)/i) || href.match(/\/(\d+)$/);
          if (!articleMatch) return;

          const articleId = articleMatch[1];
          if (results.find(r => r.id === articleId)) return;

          articles.push({ id: articleId, title, url: `https://cafe.naver.com/reptilia/${articleId}` });
        });

        // 각 게시글 본문에서 가격 파싱 (최대 5개씩)
        for (const article of articles.slice(0, 5)) {
          try {
            const ar = await fetch(`https://cafe.naver.com/reptilia/${article.id}`, {
              headers: {
                'Cookie': NAVER_COOKIE,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://cafe.naver.com/reptilia'
              }
            });
            if (!ar.ok) continue;
            const aHtml = await ar.text();

            const price = parseKRW(aHtml);
            if (!price) continue;

            // 이미지 추출
            const $a = cheerio.load(aHtml);
            const imgSrc = $a('.se-image-resource, .ContentRenderer img, .se-module-image img').first().attr('src') || null;

            results.push({
              id: article.id,
              name: article.title.slice(0, 50),
              price,
              priceDisplay: price.toLocaleString('ko-KR') + '원',
              region: '',
              seller: '',
              sex: guessSex(aHtml),
              size: guessSize(aHtml),
              img: imgSrc,
              url: article.url,
              src: 'pasamo',
              createdAt: new Date().toISOString()
            });
          } catch (e) {
            console.warn('게시글 파싱 오류:', e.message);
          }
        }

        // 더 이상 결과 없으면 중단
        if (articles.length === 0) break;

        // 요청 간격 (서버 부하 방지)
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`파사모 아잔틱 ${results.length}개 발견`);
    res.json({ success: true, count: results.length, data: results });

  } catch (e) {
    console.error('파사모 오류:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 통합 검색 ──
app.get('/api/search', async (req, res) => {
  try {
    const [feedleRes, pasamoRes] = await Promise.allSettled([
      fetch(`http://localhost:${PORT}/api/feedle`).then(r => r.json()),
      fetch(`http://localhost:${PORT}/api/pasamo`).then(r => r.json())
    ]);

    const feedleData = feedleRes.status === 'fulfilled' ? (feedleRes.value.data || []) : [];
    const pasamoData = pasamoRes.status === 'fulfilled' ? (pasamoRes.value.data || []) : [];
    const all = [...feedleData, ...pasamoData];

    res.json({
      success: true,
      count: all.length,
      feedleCount: feedleData.length,
      pasamoCount: pasamoData.length,
      data: all
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 유틸 함수 ──
function parseKRW(text) {
  const pats = [
    [/분양가\s*:?\s*([\d,]+)\s*만원/, true],
    [/가격\s*:?\s*([\d,]+)\s*만원/, true],
    [/([\d,]+)\s*만원/, true],
    [/([\d]+)\s*만\b/, true],
    [/₩\s*([\d,]+)/, false],
    [/([\d,]{5,})\s*원/, false]
  ];
  for (const [pat, isMan] of pats) {
    const m = text.match(pat);
    if (!m) continue;
    let n = parseInt(m[1].replace(/,/g, ''));
    if (isMan) n *= 10000;
    if (n >= 10000 && n <= 50000000) return n;
  }
  return 0;
}
function guessSex(t) {
  return /수컷|male/i.test(t) ? '수컷' : /암컷|female/i.test(t) ? '암컷' : '미구분';
}
function guessSize(t) {
  return /베이비|baby/i.test(t) ? '베이비' : /주브나일|juvenile/i.test(t) ? '주브나일'
    : /서브어덜트|subadult/i.test(t) ? '서브어덜트' : /어덜트|adult/i.test(t) ? '어덜트' : '';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
