require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const compression = require('compression');
const multer = require('multer');

const app = express();

// ===== ファイルアップロード設定 =====
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = crypto.randomBytes(12).toString('hex') + ext;
      cb(null, name);
    }
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('対応していないファイル形式です。JPG, PNG, GIF, WEBP, PDFのみ対応しています。'));
    }
  }
});
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// ===== 本番環境設定 =====
if (IS_PRODUCTION) {
  app.set('trust proxy', 1); // Nginx背後で動作
}

// セキュリティヘッダー
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// アクセスログ（本番環境）
if (IS_PRODUCTION) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const ip = req.ip || req.connection.remoteAddress;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms - ${ip}`);
    });
    next();
  });
}

// ===== Config =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'takehiro.okamoto@terass.com';
const SMTP_HOST = process.env.SMTP_HOST || 'mail.muchinochi55.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const TIMEREX_URL = process.env.TIMEREX_URL || 'https://timerex.net/s/takehiro.okamoto_294e/32359692';
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
let ADMIN_PASS = process.env.ADMIN_PASS || (IS_PRODUCTION ? '' : 'muchinavi2026');
if (IS_PRODUCTION && !ADMIN_PASS) {
  console.error('⚠️  本番環境では ADMIN_PASS 環境変数が必須です');
  process.exit(1);
}
if (IS_PRODUCTION && !GEMINI_API_KEY) {
  console.error('⚠️  本番環境では GEMINI_API_KEY 環境変数が必須です');
  process.exit(1);
}

// ===== Perplexity API設定（リアルタイム検索） =====
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const PERPLEXITY_CACHE = new Map(); // キャッシュ（キー: クエリ, 値: {data, timestamp}）
const PERPLEXITY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

/**
 * 顧客の質問が最新情報を必要とするか判定する
 * @param {string} message - 顧客のメッセージ
 * @returns {string|null} - 検索クエリ（不要ならnull）
 */
function detectRealtimeInfoNeed(message) {
  const patterns = [
    { keywords: ['金利', '利率', '利息', '変動金利', '固定金利', 'フラット35'], query: '2026年3月 住宅ローン 変動金利 主要銀行別 適用金利 auじぶん銀行 住信SBI PayPay銀行 三菱UFJ フラット35' },
    { keywords: ['住宅ローン控除', 'ローン控除', '控除額', '税金が戻る', '還付'], query: '2026年 住宅ローン控除 条件 控除額 最新 変更点' },
    { keywords: ['相場', '価格', 'いくら', '坪単価', 'マンション価格', '戸建て価格'], query: null }, // エリア付きで動的生成
    { keywords: ['補助金', '給付金', '助成金', '支援金', '子育て支援'], query: '2026年 住宅購入 補助金 給付金 子育て世帯 支援 最新' },
    { keywords: ['省エネ', 'ZEH', 'ゼッチ', '断熱', '省エネ住宅'], query: '2026年 省エネ住宅 ZEH 補助金 認定基準 最新' },
    { keywords: ['審査', '審査基準', '通りやすい', '落ちる', '審査に通る'], query: '2026年 住宅ローン 審査基準 年収倍率 通りやすい銀行 最新' },
    { keywords: ['頭金', '諸費用', '初期費用', '手付金'], query: '2026年 住宅購入 頭金 諸費用 相場 目安' },
    { keywords: ['日銀', '利上げ', '金融政策', '政策金利'], query: '2026年 日銀 金融政策 利上げ 住宅ローン影響 最新' },
  ];

  const msg = message.toLowerCase();

  for (const p of patterns) {
    if (p.keywords.some(k => msg.includes(k))) {
      if (p.query) return p.query;
      // 相場系: エリア名を含める
      const areaMatch = msg.match(/(大阪|東京|名古屋|横浜|神戸|京都|北摂|吹田|豊中|箕面|尼崎|西宮|芦屋|梅田|難波|天王寺)/);
      const area = areaMatch ? areaMatch[1] : '大阪';
      return `2026年 ${area} 不動産 マンション 価格 相場 最新`;
    }
  }

  return null; // 最新情報不要
}

/**
 * Perplexity APIで最新情報を検索する（キャッシュ付き）
 * @param {string} query - 検索クエリ
 * @returns {Promise<string|null>} - 検索結果テキスト（エラー時null）
 */
async function searchPerplexity(query) {
  if (!PERPLEXITY_API_KEY) return null;

  // キャッシュチェック
  const cached = PERPLEXITY_CACHE.get(query);
  if (cached && (Date.now() - cached.timestamp) < PERPLEXITY_CACHE_TTL) {
    console.log(`📦 Perplexity キャッシュヒット: "${query.substring(0, 30)}..."`);
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: '不動産・住宅購入に関する最新の事実データを提供してください。必ず具体的な数値（金利なら銀行名と%、価格なら平均額と㎡単価）を含めてください。曖昧な範囲（例:「0.3%〜1%程度」）ではなく、主要銀行ごとの実際の適用金利を記載してください。日本語で500文字以内。' },
          { role: 'user', content: query },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`❌ Perplexity API エラー: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || null;
    const citations = data.citations || [];
    const cost = data.usage?.cost?.total_cost || 0;

    console.log(`🔍 Perplexity 検索完了: "${query.substring(0, 30)}..." (コスト: $${cost.toFixed(4)}, 出典: ${citations.length}件)`);

    // 出典URLを追加
    const result = content ? `${content}\n\n【情報ソース】${citations.slice(0, 3).join(', ')}` : null;

    // キャッシュ保存
    if (result) {
      PERPLEXITY_CACHE.set(query, { data: result, timestamp: Date.now() });
    }

    return result;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('⏰ Perplexity API タイムアウト (8秒)');
    } else {
      console.error('❌ Perplexity API エラー:', e.message);
    }
    return null; // フォールバック: Geminiだけで回答
  }
}

// ===== メール送信ヘルパー =====
function createTransporter() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendNotificationEmail({ to, subject, html }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log('⚠️ SMTP未設定のためメール通知をスキップ');
    return;
  }
  try {
    await transporter.sendMail({
      from: `岡本岳大｜住宅購入エージェント <${SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`✅ メール送信成功: ${to} / ${subject}`);
  } catch (e) {
    console.error(`❌ メール送信失敗: ${to}`, e.message);
  }
}

// ===== Blog Articles Database (WordPress自動連携) =====
const BLOG_WP_URL = 'https://muchinochi55.com';
let BLOG_ARTICLES = []; // WordPress APIから自動取得（起動時＋定期更新）
let blogArticlesLastFetch = null;
const BLOG_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6時間ごとに更新

// WordPressカテゴリIDとシステム内カテゴリのマッピング（初回取得時に自動構築）
let wpCategoryMap = {};

// WordPress REST APIから全記事を取得
async function fetchBlogArticlesFromWP() {
  try {
    console.log('📰 WordPress記事を取得中...');

    // 1) カテゴリ一覧を取得
    const catRes = await fetch(`${BLOG_WP_URL}/wp-json/wp/v2/categories?per_page=100`);
    if (!catRes.ok) throw new Error(`カテゴリ取得失敗: ${catRes.status}`);
    const categories = await catRes.json();

    // カテゴリ名 → システム内カテゴリ名のマッピング
    const categoryNameMap = {
      '住宅ローン': 'loan', 'ローン': 'loan', 'loan': 'loan',
      'ライフプラン': 'lifeplan', 'lifeplan': 'lifeplan', '生活設計': 'lifeplan',
      '家探し': 'hunting', '物件選び': 'hunting', '物件探し': 'hunting', 'hunting': 'hunting',
      'ハウスメーカー': 'housemaker', '注文住宅': 'housemaker', 'housemaker': 'housemaker',
      '大阪': 'area-osaka', 'エリア大阪': 'area-osaka',
      '東京': 'area-tokyo', 'エリア東京': 'area-tokyo',
      'マンション': 'mansion', 'mansion': 'mansion',
      'エリア': 'area', '不動産基礎知識': 'basics', '税金': 'tax',
    };
    wpCategoryMap = {};
    categories.forEach(cat => {
      const catName = cat.name.trim();
      // 完全一致 → 部分一致の順で検索
      let mapped = categoryNameMap[catName];
      if (!mapped) {
        for (const [key, val] of Object.entries(categoryNameMap)) {
          if (catName.includes(key) || key.includes(catName)) { mapped = val; break; }
        }
      }
      wpCategoryMap[cat.id] = mapped || catName.toLowerCase().replace(/\s+/g, '-');
    });

    // 2) タグ一覧を取得（キーワードとして利用）
    let allTags = {};
    let tagPage = 1;
    while (true) {
      const tagRes = await fetch(`${BLOG_WP_URL}/wp-json/wp/v2/tags?per_page=100&page=${tagPage}`);
      if (!tagRes.ok) break;
      const tags = await tagRes.json();
      if (tags.length === 0) break;
      tags.forEach(t => { allTags[t.id] = t.name; });
      tagPage++;
      if (tags.length < 100) break;
    }

    // 3) 全記事をページネーションで取得
    let allArticles = [];
    let page = 1;
    while (true) {
      const postRes = await fetch(
        `${BLOG_WP_URL}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,link,categories,tags,status&status=publish`
      );
      if (!postRes.ok) {
        if (postRes.status === 400) break; // ページ超過
        throw new Error(`記事取得失敗: ${postRes.status}`);
      }
      const posts = await postRes.json();
      if (posts.length === 0) break;

      posts.forEach(post => {
        // タイトルからHTMLエンティティをデコード
        const title = post.title.rendered
          .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
          .replace(/&#8216;/g, "'").replace(/&#8217;/g, "'")
          .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
          .replace(/&#038;/g, '&').replace(/&amp;/g, '&')
          .replace(/<[^>]+>/g, '').trim();

        // カテゴリ決定（最初のカテゴリを使用）
        const catId = (post.categories && post.categories.length > 0) ? post.categories[0] : null;
        const category = catId ? (wpCategoryMap[catId] || 'general') : 'general';

        // タグからキーワードを抽出
        const keywords = (post.tags || [])
          .map(tagId => allTags[tagId])
          .filter(Boolean);

        // タイトルから追加キーワード抽出（日本語の主要名詞）
        if (keywords.length === 0) {
          const titleKeywords = title
            .replace(/[【】「」『』（）\(\)\[\]｜|／\/、。！？!?…～〜]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2 && w.length <= 15);
          keywords.push(...titleKeywords.slice(0, 5));
        }

        allArticles.push({ category, title, url: post.link, keywords });
      });

      page++;
      if (posts.length < 100) break;
    }

    if (allArticles.length > 0) {
      BLOG_ARTICLES = allArticles;
      blogArticlesLastFetch = Date.now();
      console.log(`✅ WordPress記事取得完了: ${allArticles.length}本（${Object.keys(wpCategoryMap).length}カテゴリ）`);
    } else {
      console.warn('⚠️ WordPress記事が0件。フォールバック記事を維持します。');
    }
  } catch (err) {
    console.error('❌ WordPress記事取得エラー:', err.message);
    // 既存のキャッシュがあればそのまま使う。なければフォールバック。
    if (BLOG_ARTICLES.length === 0) {
      console.log('📦 フォールバック記事を使用します');
      BLOG_ARTICLES = FALLBACK_ARTICLES;
    }
  }
}

// フォールバック記事（WordPress APIが使えない場合の最低限）
const FALLBACK_ARTICLES = [
  { category: 'loan', title: '住宅ローンの基本と選び方完全ガイド', url: 'https://muchinochi55.com/【2025年版】住宅ローンの基本と選び方完全ガイド/', keywords: ['住宅ローン', '選び方', '基本'] },
  { category: 'lifeplan', title: 'ライフプランを立てずに家を買うとどうなる？', url: 'https://muchinochi55.com/ライフプランを立てずに家を買うとどうなる？失/', keywords: ['ライフプラン', '失敗', '計画'] },
  { category: 'hunting', title: '家探しで失敗しない3つのステップ', url: 'https://muchinochi55.com/家探し初心者必見！失敗しない3つのステップと成/', keywords: ['初心者', '失敗しない', 'ステップ'] },
];

// 定期的にWordPressから記事を更新
function startBlogArticleSync() {
  // 起動時に即取得
  fetchBlogArticlesFromWP();
  // 6時間ごとに再取得
  setInterval(() => {
    fetchBlogArticlesFromWP();
  }, BLOG_CACHE_DURATION);
}

// 管理者用: 手動で記事を再取得するAPIエンドポイント
// (後でapp.postに追加)

// ===== Simple JSON Database =====
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'customers.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('DB読み込みエラー:', e.message);
  }
  return {};
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// ===== Tags Database =====
const TAGS_FILE = path.join(DATA_DIR, 'tags.json');
function loadTags() {
  try {
    if (fs.existsSync(TAGS_FILE)) return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8'));
  } catch (e) { console.error('タグDB読み込みエラー:', e.message); }
  return { tags: [] };
}
function saveTags(data) {
  fs.writeFileSync(TAGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ===== Broadcasts Database =====
const BROADCASTS_FILE = path.join(DATA_DIR, 'broadcasts.json');
function loadBroadcasts() {
  try {
    if (fs.existsSync(BROADCASTS_FILE)) return JSON.parse(fs.readFileSync(BROADCASTS_FILE, 'utf-8'));
  } catch (e) { console.error('配信DB読み込みエラー:', e.message); }
  return { broadcasts: [] };
}
function saveBroadcasts(data) {
  fs.writeFileSync(BROADCASTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ===== Tag Filtering Helper =====
function filterCustomersByTags(customers, filterType, filterTags) {
  // customers: array of [token, record]
  // Only active customers with email
  const active = customers.filter(([_, r]) => r.status !== 'blocked' && r.status !== 'withdrawn');

  if (filterType === 'all') return active;
  if (!filterTags || !filterTags.length) return active;

  return active.filter(([_, r]) => {
    const ct = r.tags || [];
    switch (filterType) {
      case 'include-all':
        return filterTags.every(t => ct.includes(t));
      case 'include-any':
        return filterTags.some(t => ct.includes(t));
      case 'exclude-all':
        // 全タグを持つ人を除外
        return !filterTags.every(t => ct.includes(t));
      case 'exclude-any':
        // いずれかのタグを持つ人を除外
        return !filterTags.some(t => ct.includes(t));
      default:
        return true;
    }
  });
}

// ===== Settings (Admin Password) =====
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (settings.adminPassword) {
        ADMIN_PASS = settings.adminPassword;
      }
    }
  } catch (e) {
    console.error('Settings読み込みエラー:', e.message);
  }
}

function saveSettings() {
  const settings = { adminPassword: ADMIN_PASS };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// Load settings on startup
loadSettings();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// ===== Middleware =====
app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json());

// Service Workerはキャッシュしない（常に最新版を取得）
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// アップロードファイル配信
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// 静的ファイルにキャッシュ設定（HTML/CSS/JSを5分キャッシュ）
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '5m',
  etag: true,
  lastModified: true
}));

// ===== Health check =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== Public config (non-sensitive) =====
app.get('/api/config', (req, res) => {
  res.json({ timerexURL: TIMEREX_URL });
});

// ===== Gemini API テスト =====
app.get('/api/test-chat', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.json({ success: false, error: 'GEMINI_API_KEY が未設定です' });
  }
  try {
    console.log('🧪 Gemini APIテスト開始... APIキー:', GEMINI_API_KEY.substring(0, 10) + '...');
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('こんにちはと日本語で一言返してください');
    const reply = result.response.text();
    console.log('✅ Gemini APIテスト成功:', reply.substring(0, 50));
    res.json({ success: true, reply: reply.substring(0, 100) });
  } catch (e) {
    console.error('❌ Gemini APIテスト失敗:', e.message);
    res.json({ success: false, error: e.message });
  }
});

// ===== SMTP接続テスト =====
app.get('/api/test-email', async (req, res) => {
  if (!SMTP_USER || !SMTP_PASS) {
    return res.json({
      success: false,
      error: 'SMTP_USER または SMTP_PASS が未設定です',
      config: {
        SMTP_USER: SMTP_USER ? `${SMTP_USER.substring(0, 4)}...` : '未設定',
        SMTP_PASS: SMTP_PASS ? '設定済み（非表示）' : '未設定',
        NOTIFY_EMAIL: NOTIFY_EMAIL,
      }
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    // SMTP接続を検証
    await transporter.verify();
    console.log('✅ SMTP接続テスト成功');

    // テストメール送信
    await transporter.sendMail({
      from: `MuchiNavi テスト <${SMTP_USER}>`,
      to: NOTIFY_EMAIL,
      subject: '【MuchiNavi】メール送信テスト成功',
      html: `
        <div style="font-family: sans-serif; padding: 24px; text-align: center;">
          <h2 style="color: #34c759;">✅ メール送信テスト成功！</h2>
          <p>MuchiNaviからのメール通知が正常に機能しています。</p>
          <p style="color: #6e6e73; font-size: 13px;">${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>
        </div>
      `,
    });

    res.json({ success: true, message: `テストメールを ${NOTIFY_EMAIL} に送信しました` });
  } catch (e) {
    console.error('❌ SMTP接続テスト失敗:', e.message);
    res.json({
      success: false,
      error: e.message,
      hint: e.message.includes('Invalid login')
        ? 'Gmailのアプリパスワードが正しくないか、2段階認証が有効になっていない可能性があります'
        : e.message.includes('EAUTH')
          ? 'SMTPの認証に失敗しました。アプリパスワードを再確認してください'
          : 'SMTP設定を確認してください',
    });
  }
});

// ===== Customer Registration → Save + Email =====
app.post('/api/register', async (req, res) => {
  const customer = req.body;
  const token = generateToken();

  // Hash password and remove plain password
  const passwordHash = customer.password ? hashPassword(customer.password) : null;
  delete customer.password; // Don't store plain password

  // Auto-assign tags based on registration data
  const autoTags = [];
  const tagData = loadTags();

  // Helper: ensure tag exists and add to autoTags
  function ensureTagAndAdd(tagName, color, category) {
    if (!tagName || tagName === '-' || tagName === '未入力') return;
    const existing = tagData.tags.find(t => t.name === tagName);
    if (!existing) {
      tagData.tags.push({ id: 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), name: tagName, color: color, category: category || '' });
    } else if (category && !existing.category) {
      // Existing tag without category - add category
      existing.category = category;
    }
    if (!autoTags.includes(tagName)) {
      autoTags.push(tagName);
    }
  }

  // Prefecture auto-tag (都道府県)
  if (customer.prefecture) {
    ensureTagAndAdd(customer.prefecture, '#5856d6', '都道府県');
  }

  // Property type auto-tag (物件種別)
  if (customer.propertyType) {
    ensureTagAndAdd(customer.propertyType, '#0071e3', '物件種別');
  }

  // Save tags if new ones were created
  if (autoTags.length > 0) {
    saveTags(tagData);
    console.log('🏷️ 自動タグ付与:', autoTags.join(', '));
  }

  // Save to DB
  const db = loadDB();
  // Determine initial stage based on profile completeness
  const profileFields = ['name','birthYear','prefecture','family','householdIncome','propertyType','area','budget','email','phone'];
  const filled = profileFields.filter(f => customer[f] && customer[f] !== '' && customer[f] !== '-' && customer[f] !== '未入力').length;
  const initialStage = (filled >= Math.ceil(profileFields.length * 0.7)) ? 2 : 1;

  db[token] = {
    ...customer,
    passwordHash,
    token,
    chatHistory: [],
    directChatHistory: [],
    tags: autoTags,
    stage: initialStage,
    createdAt: new Date().toISOString(),
  };
  if (initialStage > 1) console.log(`📊 登録時ステージ自動判定: ${initialStage} (${filled}/${profileFields.length}項目入力済み)`);
  saveDB(db);

  console.log('📩 新規登録:', customer.name, customer.email, '→ トークン:', token);

  // Send emails (non-blocking — registration always succeeds)
  try {
    if (SMTP_USER && SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      // Verify SMTP connection first
      try {
        await transporter.verify();
        console.log('✅ SMTP接続OK');
      } catch (smtpErr) {
        console.error('❌ SMTP認証エラー:', smtpErr.message);
        console.error('💡 Gmailのアプリパスワードを再確認してください: https://myaccount.google.com/apppasswords');
        return res.json({ success: true, token, emailError: 'SMTP認証に失敗しました。アプリパスワードを確認してください。' });
      }

      // ===== 1) お客様への登録完了メール =====
      if (customer.email) {
        // AIでお客様に最適な記事を選定
        let recommendedArticles = [];
        try {
          if (GEMINI_API_KEY) {
            const articleList = BLOG_ARTICLES.map((a, i) => `${i}: ${a.title}【${a.category}】`).join('\n');
            const customerProfile = `名前: ${customer.name}, 家族: ${customer.family || '未入力'}, 物件種別: ${customer.propertyType || '未入力'}, 目的: ${customer.purpose || '未入力'}, エリア: ${customer.area || '未入力'}, 予算: ${customer.budget || '未入力'}, 世帯年収: ${customer.householdIncome || '未入力'}, 探索理由: ${customer.searchReason || '未入力'}`;
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } });
            const result = await model.generateContent(`以下のお客様プロフィールに基づき、最も今読むべき・役立つ記事を3つ選んでください。お客様の状況、悩み、目的に寄り添った選定をしてください。

お客様プロフィール: ${customerProfile}

記事一覧:
${articleList}

JSON形式で記事のインデックス番号を3つ返してください: {"indices": [0, 1, 2]}`);
            const parsed = JSON.parse(result.response.text());
            const indices = (parsed.indices || []).slice(0, 3);
            indices.forEach(idx => {
              if (BLOG_ARTICLES[idx]) {
                recommendedArticles.push({ title: BLOG_ARTICLES[idx].title, url: BLOG_ARTICLES[idx].url });
              }
            });
          }
        } catch (aiErr) {
          console.error('記事AI選定エラー:', aiErr.message);
        }
        // フォールバック
        if (recommendedArticles.length === 0) {
          recommendedArticles = [
            { title: '家探し初心者必見！失敗しない3つのステップ', url: 'https://muchinochi55.com/家探し初心者必見！失敗しない3つのステップと成/' },
            { title: '住宅ローンの基本と選び方完全ガイド', url: 'https://muchinochi55.com/【2025年版】住宅ローンの基本と選び方完全ガイド/' },
            { title: '月々の返済額はいくらが理想？', url: 'https://muchinochi55.com/【完全解説】月々の返済額はいくらが理想？無理/' },
          ];
        }

        const articleCards = recommendedArticles.map(a => `
          <tr>
            <td style="padding: 0 0 10px 0;">
              <a href="${a.url}" style="display: block; padding: 14px 18px; background: #f0f7ff; border-radius: 12px; text-decoration: none; color: #1d1d1f; border: 1px solid #e5e5ea;">
                <span style="font-size: 12px; color: #0071e3; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">おすすめ記事</span><br>
                <span style="font-size: 14px; font-weight: 600; line-height: 1.5;">${a.title}</span>
              </a>
            </td>
          </tr>
        `).join('');

        const siteBaseUrl = APP_URL;

        await transporter.sendMail({
          from: `岡本岳大｜住宅購入エージェント <${SMTP_USER}>`,
          to: customer.email,
          subject: `${customer.name}さん、MuchiNaviへのご登録ありがとうございます！`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
              <!-- ヘッダー -->
              <div style="background: linear-gradient(135deg, #4a90d9, #74b9ff); padding: 40px 32px; text-align: center; border-radius: 0 0 20px 20px;">
                <div style="font-size: 32px; margin-bottom: 12px;">🏠</div>
                <h1 style="color: white; font-size: 22px; font-weight: 700; margin: 0 0 8px 0; letter-spacing: -0.02em;">
                  ご登録ありがとうございます！
                </h1>
                <p style="color: rgba(255,255,255,0.85); font-size: 13px; margin: 0;">
                  MuchiNavi — あなたの住まい探しAIアシスタント
                </p>
              </div>

              <!-- 本文 -->
              <div style="padding: 32px 28px;">
                <p style="font-size: 15px; line-height: 1.8; color: #1d1d1f; margin: 0 0 20px 0;">
                  ${customer.name}さん、こんにちは！<br>
                  住宅購入専門エージェントの<strong>岡本岳大</strong>です。
                </p>
                <p style="font-size: 14px; line-height: 1.8; color: #1d1d1f; margin: 0 0 20px 0;">
                  MuchiNaviにご登録いただき、ありがとうございます。<br>
                  ${customer.name}さんの住まい探しを全力でサポートさせていただきます。
                </p>

                <!-- 登録内容 -->
                <div style="background: #f5f5f7; border-radius: 16px; padding: 24px; margin: 24px 0;">
                  <p style="font-size: 12px; font-weight: 600; color: #6e6e73; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 16px 0;">
                    ご登録いただいた内容
                  </p>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; font-size: 13px; color: #6e6e73; width: 100px;">お名前</td>
                      <td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${customer.name || '-'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 13px; color: #6e6e73;">生年月日</td>
                      <td style="padding: 8px 0; font-size: 14px;">${customer.birthYear && customer.birthMonth ? `${customer.birthYear}年${customer.birthMonth}月` : '-'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 13px; color: #6e6e73;">家族構成</td>
                      <td style="padding: 8px 0; font-size: 14px;">${customer.family || '-'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 13px; color: #6e6e73;">物件種別</td>
                      <td style="padding: 8px 0; font-size: 14px;">${customer.propertyType || '-'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 13px; color: #6e6e73;">希望エリア</td>
                      <td style="padding: 8px 0; font-size: 14px;">${customer.area || '-'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 13px; color: #6e6e73;">ご予算</td>
                      <td style="padding: 8px 0; font-size: 14px;">${customer.budget || '-'}</td>
                    </tr>
                  </table>
                </div>

                <!-- 次のステップ -->
                <div style="margin: 28px 0;">
                  <p style="font-size: 14px; font-weight: 700; color: #1d1d1f; margin: 0 0 16px 0;">
                    📋 MuchiNaviの使い方
                  </p>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 10px 12px 10px 0; vertical-align: top;">
                        <div style="width: 28px; height: 28px; background: #4a90d9; border-radius: 50%; color: white; font-size: 13px; font-weight: 700; text-align: center; line-height: 28px;">1</div>
                      </td>
                      <td style="padding: 10px 0; font-size: 14px; line-height: 1.6;">
                        <strong>AIアシスタントに相談</strong><br>
                        <span style="color: #6e6e73; font-size: 13px;">住宅ローンや物件選びなど、何でも気軽にチャットで質問できます</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 12px 10px 0; vertical-align: top;">
                        <div style="width: 28px; height: 28px; background: #4a90d9; border-radius: 50%; color: white; font-size: 13px; font-weight: 700; text-align: center; line-height: 28px;">2</div>
                      </td>
                      <td style="padding: 10px 0; font-size: 14px; line-height: 1.6;">
                        <strong>個人チャットで直接やり取り</strong><br>
                        <span style="color: #6e6e73; font-size: 13px;">AIチャットだけでは解決しないことは、アプリ内の個人チャットで岡本と直接やり取りできます</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 12px 10px 0; vertical-align: top;">
                        <div style="width: 28px; height: 28px; background: #4a90d9; border-radius: 50%; color: white; font-size: 13px; font-weight: 700; text-align: center; line-height: 28px;">3</div>
                      </td>
                      <td style="padding: 10px 0; font-size: 14px; line-height: 1.6;">
                        <strong>もっと詳しく相談したい時は</strong><br>
                        <span style="color: #6e6e73; font-size: 13px;">オンライン面談でじっくりお話しすることもできます。ご都合に合わせてご予約ください</span>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- おすすめ記事 -->
                <div style="margin: 28px 0;">
                  <p style="font-size: 14px; font-weight: 700; color: #1d1d1f; margin: 0 0 12px 0;">
                    📖 ${customer.name}さんにおすすめの記事
                  </p>
                  <table style="width: 100%; border-collapse: collapse;">
                    ${articleCards}
                  </table>
                </div>

                <!-- オンライン予約ボタン -->
                <div style="text-align: center; margin: 32px 0 24px;">
                  <p style="font-size: 14px; color: #6e6e73; margin: 0 0 16px 0;">
                    すぐにお話ししたい方はこちら
                  </p>
                  <a href="${TIMEREX_URL}" style="display: inline-block; padding: 16px 40px; background: #4a90d9; color: white; border-radius: 980px; text-decoration: none; font-size: 15px; font-weight: 600;">
                    📅 オンライン面談を予約する
                  </a>
                </div>
              </div>

              <!-- フッター -->
              <div style="border-top: 1px solid #e5e5ea; padding: 24px 28px; text-align: center;">
                <p style="font-size: 13px; font-weight: 600; color: #1d1d1f; margin: 0 0 4px 0;">
                  岡本 岳大（おかもと たけひろ）
                </p>
                <p style="font-size: 12px; color: #6e6e73; margin: 0 0 4px 0;">
                  株式会社TERASS｜住宅購入専門エージェント
                </p>
                <p style="font-size: 12px; color: #aeaeb2; margin: 0 0 12px 0;">
                  ノルマなし・会社の規則に縛られない「本当のお客様ファースト」
                </p>
                <a href="https://muchinochi55.com" style="font-size: 12px; color: #4a90d9; text-decoration: none;">
                  むちのちブログ →
                </a>
                <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #f0f0f0;">
                  <a href="${siteBaseUrl}?t=${token}&withdraw=true" style="font-size: 11px; color: #aeaeb2; text-decoration: none;">
                    退会をご希望の方はこちら
                  </a>
                </div>
              </div>
            </div>
          `,
        });
        console.log('✅ お客様への登録完了メール送信完了:', customer.email);
      }

      // ===== 2) エージェント（岡本さん）への通知メール =====
      await transporter.sendMail({
        from: `MuchiNavi <${SMTP_USER}>`,
        to: NOTIFY_EMAIL,
        subject: `🏠【新規登録】${customer.name}さん｜${customer.area || '未定'}・${customer.budget || '未定'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
            <!-- ヘッダー -->
            <div style="background: linear-gradient(135deg, #34c759, #30b050); padding: 28px 32px; border-radius: 0 0 16px 16px;">
              <h2 style="color: white; font-size: 18px; font-weight: 700; margin: 0;">
                🔔 新規お客様が登録しました
              </h2>
              <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 6px 0 0 0;">
                ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
              </p>
            </div>

            <!-- お客様情報 -->
            <div style="padding: 28px;">
              <table style="width: 100%; border-collapse: collapse; background: #f5f5f7; border-radius: 12px; overflow: hidden;">
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; width: 110px; font-size: 13px;">お名前</td>
                  <td style="padding: 14px 16px; font-size: 15px; font-weight: 700;">${customer.name || '-'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">家族構成</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.family || '-'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">世帯年収</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.householdIncome || '-'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">物件種別</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.propertyType || '-'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">登録目的</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.purpose || '-'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">希望エリア</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.area || '-'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">予算</td>
                  <td style="padding: 14px 16px; font-size: 14px; font-weight: 600; color: #0071e3;">${customer.budget || '-'}</td>
                </tr>
                ${customer.searchReason ? `<tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">探索理由</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.searchReason}</td>
                </tr>` : ''}
                ${customer.freeComment ? `<tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">コメント</td>
                  <td style="padding: 14px 16px; font-size: 14px;">${customer.freeComment}</td>
                </tr>` : ''}
                <tr style="border-bottom: 1px solid #e5e5ea;">
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">📧 メール</td>
                  <td style="padding: 14px 16px; font-size: 14px;"><a href="mailto:${customer.email}" style="color: #0071e3; text-decoration: none;">${customer.email || '-'}</a></td>
                </tr>
                <tr>
                  <td style="padding: 14px 16px; font-weight: 600; color: #6e6e73; font-size: 13px;">📱 電話</td>
                  <td style="padding: 14px 16px; font-size: 14px;"><a href="tel:${customer.phone}" style="color: #0071e3; text-decoration: none;">${customer.phone || '-'}</a></td>
                </tr>
              </table>

              <!-- アクションボタン -->
              <div style="text-align: center; margin: 28px 0 8px;">
                <a href="mailto:${customer.email}?subject=${encodeURIComponent(`${customer.name}さん、MuchiNaviへのご登録ありがとうございます`)}"
                   style="display: inline-block; padding: 14px 32px; background: #0071e3; color: white; border-radius: 980px; text-decoration: none; font-size: 14px; font-weight: 600; margin: 0 6px 8px;">
                  ✉️ メールで連絡
                </a>
                ${customer.phone && customer.phone !== '未入力' ? `
                <a href="tel:${customer.phone}"
                   style="display: inline-block; padding: 14px 32px; background: #34c759; color: white; border-radius: 980px; text-decoration: none; font-size: 14px; font-weight: 600; margin: 0 6px 8px;">
                  📞 電話で連絡
                </a>
                ` : ''}
              </div>

              <p style="font-size: 12px; color: #aeaeb2; text-align: center; margin-top: 16px;">
                MuchiNavi Web版からの自動通知
              </p>
            </div>
          </div>
        `,
      });
      console.log('✅ エージェント通知メール送信完了');
    } else {
      console.log('⚠️ SMTP未設定のためメール通知をスキップ');
    }

    res.json({ success: true, token });
  } catch (e) {
    console.error('❌ メール送信エラー:', e.message);
    res.json({ success: true, token, emailError: e.message });
  }
});

// ===== Customer Login =====
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'メールアドレスを入力してください' });
  }

  const db = loadDB();
  // Find customer by email
  const token = Object.keys(db).find(t => {
    const r = db[t];
    return r.email && r.email.toLowerCase() === email.toLowerCase() && r.status !== 'withdrawn';
  });

  if (!token) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
  }

  const record = db[token];

  if (record.status === 'blocked') {
    return res.status(403).json({ error: 'このアカウントはブロックされています' });
  }

  // Check password
  if (!record.passwordHash) {
    // パスワード未設定の既存顧客 → メールアドレスだけでログイン許可し、パスワード設定を促す
    res.json({
      success: true,
      token: token,
      needsPassword: true,
      customer: {
        name: record.name, family: record.family, householdIncome: record.householdIncome,
        propertyType: record.propertyType, purpose: record.purpose, searchReason: record.searchReason,
        area: record.area, budget: record.budget, freeComment: record.freeComment,
        email: record.email, phone: record.phone,
      },
      chatHistory: record.chatHistory || [],
      directChatHistory: record.directChatHistory || [],
    });
    return;
  }

  if (!password || hashPassword(password) !== record.passwordHash) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
  }

  res.json({
    success: true,
    token: token,
    customer: {
      name: record.name, family: record.family, householdIncome: record.householdIncome,
      propertyType: record.propertyType, purpose: record.purpose, searchReason: record.searchReason,
      area: record.area, budget: record.budget, freeComment: record.freeComment,
      email: record.email, phone: record.phone,
    },
    chatHistory: record.chatHistory || [],
    directChatHistory: record.directChatHistory || [],
  });
});

// ===== Restore session by token =====
app.get('/api/session/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) {
    return res.json({ found: false });
  }

  // ステータスチェック
  const status = record.status || 'active';
  if (status === 'blocked') {
    return res.json({ found: true, blocked: true });
  }
  if (status === 'withdrawn') {
    return res.json({ found: false });
  }

  res.json({
    found: true,
    customer: {
      name: record.name, family: record.family, householdIncome: record.householdIncome,
      propertyType: record.propertyType, purpose: record.purpose, searchReason: record.searchReason,
      area: record.area, budget: record.budget, freeComment: record.freeComment,
      email: record.email, phone: record.phone,
    },
    chatHistory: record.chatHistory || [],
    directChatHistory: record.directChatHistory || [],
  });
});

// ===== Customer profile: GET =====
app.get('/api/customer/profile/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) {
    return res.status(404).json({ error: 'not found' });
  }
  if (record.status === 'blocked' || record.status === 'withdrawn') {
    return res.status(403).json({ error: 'access denied' });
  }

  // Return all editable fields
  const profile = {};
  const fields = ['name','birthYear','birthMonth','prefecture','family','householdIncome','propertyType','purpose','searchReason','area','budget','freeComment','email','phone','line'];
  fields.forEach(k => { profile[k] = record[k] || ''; });
  profile.stage = record.stage || 1;
  // カルテ用: エージェントからのアドバイス（お客様向け公開メモ）
  profile.customerAdvice = record.customerAdvice || '';
  res.json({ success: true, profile });
});

// ===== Customer profile: PUT =====
app.put('/api/customer/profile/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) {
    return res.status(404).json({ error: 'not found' });
  }
  if (record.status === 'blocked' || record.status === 'withdrawn') {
    return res.status(403).json({ error: 'access denied' });
  }

  const allowed = ['name','birthYear','birthMonth','prefecture','family','householdIncome','propertyType','purpose','searchReason','area','budget','freeComment','email','phone','line'];
  const updates = req.body;
  let changed = [];
  allowed.forEach(key => {
    if (updates[key] !== undefined && updates[key] !== record[key]) {
      record[key] = updates[key];
      changed.push(key);
    }
  });

  // Recalculate age from birthYear/birthMonth if changed
  if (updates.birthYear && updates.birthMonth) {
    const now = new Date();
    let age = now.getFullYear() - parseInt(updates.birthYear);
    if (now.getMonth() + 1 < parseInt(updates.birthMonth)) age--;
    record.age = age;
  }

  // Auto-stage: check if profile is 70%+ filled → stage 2
  if (!record.stage || record.stage < 2) {
    const profileFields = ['name','birthYear','prefecture','family','householdIncome','propertyType','area','budget','email','phone'];
    const filled = profileFields.filter(f => record[f] && record[f] !== '' && record[f] !== '-' && record[f] !== '未入力').length;
    if (filled >= Math.ceil(profileFields.length * 0.7)) {
      record.stage = 2;
    }
  }

  saveDB(db);
  res.json({ success: true, message: '保存しました', changed });
});

// ===== 顧客ステージ更新（自動進行用）=====
app.post('/api/customer/advance-stage/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  if (record.status === 'blocked' || record.status === 'withdrawn')
    return res.status(403).json({ error: 'access denied' });

  const { stage } = req.body;
  const currentStage = record.stage || 1;

  // Only allow advancing forward (not going back), max +1 step at a time from customer side
  if (stage && stage > currentStage && stage <= currentStage + 1 && stage <= 3) {
    record.stage = stage;
    saveDB(db);
    console.log(`📊 ステージ進行: ${record.name} → ${stage}`);
    res.json({ success: true, stage: record.stage });
  } else {
    res.json({ success: false, message: 'ステージ変更できません', stage: currentStage });
  }
});

// ===== ファイルアップロード（顧客側） =====
app.post('/api/customer/upload/:token', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'ファイルサイズが10MBを超えています' });
      }
      return res.status(400).json({ error: err.message || 'アップロードに失敗しました' });
    }
    if (!req.file) return res.status(400).json({ error: 'ファイルが選択されていません' });

    const db = loadDB();
    const record = db[req.params.token];
    if (!record) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'not found' });
    }

    // multerはlatin1でデコードするため、日本語ファイル名をUTF-8に変換
    let originalName;
    try {
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      originalName = req.file.originalname;
    }

    const fileInfo = {
      id: 'file_' + Date.now(),
      filename: req.file.filename,
      originalName: originalName,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: '/uploads/' + req.file.filename,
      sender: 'customer',
      createdAt: new Date().toISOString()
    };

    if (!record.files) record.files = [];
    record.files.push(fileInfo);
    saveDB(db);

    console.log(`📎 ファイル受信: ${record.name} → ${originalName} (${(req.file.size/1024).toFixed(1)}KB)`);
    res.json({ success: true, file: fileInfo });
  });
});

// ===== ファイルアップロード（管理者側） =====
app.post('/api/admin/upload/:token', adminAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'ファイルサイズが10MBを超えています' });
      }
      return res.status(400).json({ error: err.message || 'アップロードに失敗しました' });
    }
    if (!req.file) return res.status(400).json({ error: 'ファイルが選択されていません' });

    const db = loadDB();
    const record = db[req.params.token];
    if (!record) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'not found' });
    }

    let originalName;
    try {
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      originalName = req.file.originalname;
    }

    const fileInfo = {
      id: 'file_' + Date.now(),
      filename: req.file.filename,
      originalName: originalName,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: '/uploads/' + req.file.filename,
      sender: 'agent',
      createdAt: new Date().toISOString()
    };

    if (!record.files) record.files = [];
    record.files.push(fileInfo);
    saveDB(db);

    console.log(`📎 ファイル送信: → ${record.name} : ${originalName} (${(req.file.size/1024).toFixed(1)}KB)`);
    res.json({ success: true, file: fileInfo });
  });
});

// ===== ファイル一覧（顧客側） =====
app.get('/api/customer/files/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  res.json({ files: record.files || [] });
});

// ===== ファイル一覧（管理者側） =====
app.get('/api/admin/files/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  res.json({ files: record.files || [] });
});

// ===== フィードバック送信 =====
app.post('/api/customer/feedback/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  if (record.status === 'blocked' || record.status === 'withdrawn')
    return res.status(403).json({ error: 'access denied' });

  const { rating, tags, comment, trigger } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: '評価は1〜5で入力してください' });

  if (!record.feedback) record.feedback = [];
  record.feedback.push({
    id: 'fb_' + Date.now(),
    rating: parseInt(rating, 10),
    tags: tags || [],
    comment: comment || '',
    trigger: trigger || 'manual', // 'stage_change' | 'conversation' | 'manual'
    stage: record.stage || 1,
    createdAt: new Date().toISOString()
  });
  saveDB(db);

  console.log(`💬 フィードバック: ${record.name} ★${rating} ${tags?.join(',')||''} ${comment||''}`);

  // 管理者にメール通知（低評価の場合）
  if (parseInt(rating, 10) <= 2) {
    sendNotificationEmail({
      to: NOTIFY_EMAIL,
      subject: `⚠️ 低評価フィードバック: ${record.name}さん (★${rating})`,
      html: `<p><strong>${record.name}</strong>さんから低評価のフィードバックがありました。</p>
        <p>評価: ★${rating}/5</p>
        <p>選択項目: ${(tags||[]).join(', ') || 'なし'}</p>
        <p>コメント: ${comment || 'なし'}</p>
        <p>ステージ: ${record.stage || 1}</p>
        <p>トリガー: ${trigger || '-'}</p>`
    }).catch(e => console.error('フィードバック通知メール失敗:', e.message));
  }

  res.json({ success: true });
});

// ===== 管理API: フィードバック一覧 =====
app.get('/api/admin/feedback', adminAuth, (req, res) => {
  const db = loadDB();
  const allFeedback = [];
  Object.entries(db).forEach(([token, record]) => {
    if (record.feedback && record.feedback.length > 0) {
      record.feedback.forEach(fb => {
        allFeedback.push({
          ...fb,
          customerName: record.name || '名前未設定',
          customerToken: token
        });
      });
    }
  });
  allFeedback.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 統計
  const ratings = allFeedback.map(f => f.rating);
  const avg = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const distribution = [0, 0, 0, 0, 0];
  ratings.forEach(r => { distribution[r - 1]++; });

  res.json({
    feedback: allFeedback,
    stats: {
      total: allFeedback.length,
      average: parseFloat(avg),
      distribution
    }
  });
});

// ===== お知らせ通知 =====
const ANNOUNCEMENTS_FILE = path.join(__dirname, 'announcements.json');

function loadAnnouncements() {
  try {
    if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf-8'));
    }
  } catch (e) { console.error('Error loading announcements:', e); }
  return [];
}

function saveAnnouncements(data) {
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(data, null, 2));
}

// 管理者: お知らせ一覧取得
app.get('/api/admin/announcements', adminAuth, (req, res) => {
  res.json(loadAnnouncements());
});

// 管理者: お知らせ作成
app.post('/api/admin/announcements', adminAuth, (req, res) => {
  const { title, content, type } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'タイトルと内容は必須です' });

  const announcements = loadAnnouncements();
  const announcement = {
    id: crypto.randomBytes(8).toString('hex'),
    title: title.trim(),
    content: content.trim(),
    type: type || 'update', // update, feature, info
    createdAt: new Date().toISOString()
  };
  announcements.unshift(announcement);
  saveAnnouncements(announcements);
  res.json(announcement);
});

// 管理者: お知らせ削除
app.delete('/api/admin/announcements/:id', adminAuth, (req, res) => {
  let announcements = loadAnnouncements();
  announcements = announcements.filter(a => a.id !== req.params.id);
  saveAnnouncements(announcements);
  res.json({ success: true });
});

// 顧客: お知らせ取得（未読含む）
app.get('/api/customer/announcements/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });

  const announcements = loadAnnouncements();
  const readIds = record.readAnnouncements || [];
  const result = announcements.map(a => ({
    ...a,
    isRead: readIds.includes(a.id)
  }));
  const unreadCount = result.filter(a => !a.isRead).length;

  res.json({ announcements: result, unreadCount });
});

// 顧客: お知らせ既読
app.post('/api/customer/announcements/:token/read', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });

  if (!record.readAnnouncements) record.readAnnouncements = [];
  const { ids } = req.body;
  if (ids && Array.isArray(ids)) {
    ids.forEach(id => {
      if (!record.readAnnouncements.includes(id)) {
        record.readAnnouncements.push(id);
      }
    });
    saveDB(db);
  }
  res.json({ success: true });
});

// ===== 顧客パスワード変更 =====
app.post('/api/customer/change-password/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  if (record.status === 'blocked' || record.status === 'withdrawn')
    return res.status(403).json({ error: 'access denied' });

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上で入力してください' });
  }
  record.passwordHash = hashPassword(newPassword);
  saveDB(db);
  res.json({ success: true, message: 'パスワードを変更しました' });
});

// ===== パスワードリセット（メール確認 → 新パスワード設定） =====
app.post('/api/reset-password', (req, res) => {
  const { email, newPassword } = req.body;
  if (!email) return res.status(400).json({ error: 'メールアドレスを入力してください' });

  const db = loadDB();
  const entry = Object.entries(db).find(([, v]) => v.email === email && v.status !== 'withdrawn');
  if (!entry) {
    return res.status(404).json({ error: 'このメールアドレスは登録されていません' });
  }

  // Phase 1: メール確認だけ（newPasswordなし）
  if (!newPassword) {
    return res.json({ success: true, verified: true, message: 'メールアドレスが確認できました' });
  }

  // Phase 2: 新パスワード設定
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上で入力してください' });
  }
  const [token, record] = entry;
  record.passwordHash = hashPassword(newPassword);
  saveDB(db);
  res.json({ success: true, reset: true, message: 'パスワードを再設定しました' });
});

// ===== Save chat history =====
app.post('/api/chat-history/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) {
    return res.json({ success: false });
  }
  record.chatHistory = req.body.messages || [];
  saveDB(db);
  res.json({ success: true });
});

// ===== Save direct chat history (顧客側から送信) =====
app.post('/api/direct-chat-history/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) {
    return res.json({ success: false });
  }
  const oldMessages = record.directChatHistory || [];
  const newMessages = req.body.messages || [];

  // 新しいユーザーメッセージがあるか検出 → エージェントにメール通知
  if (newMessages.length > oldMessages.length) {
    const latest = newMessages[newMessages.length - 1];
    if (latest && latest.role === 'user') {
      const customerName = record.name || '名前未登録';
      const msgPreview = (latest.content || '').slice(0, 200);
      sendNotificationEmail({
        to: NOTIFY_EMAIL,
        subject: `💬 ${customerName}さんからメッセージが届きました`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 20px 24px; border-radius: 16px 16px 0 0;">
              <h2 style="margin: 0; font-size: 18px;">💬 新しいメッセージ</h2>
            </div>
            <div style="background: #fff; border: 1px solid #e5e5ea; border-top: none; padding: 24px; border-radius: 0 0 16px 16px;">
              <p style="margin: 0 0 6px; font-size: 13px; color: #86868b;">送信者</p>
              <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #1d1d1f;">${customerName}さん</p>
              <p style="margin: 0 0 6px; font-size: 13px; color: #86868b;">メッセージ内容</p>
              <div style="background: #f5f5f7; border-radius: 12px; padding: 16px; margin: 0 0 20px;">
                <p style="margin: 0; font-size: 15px; color: #1d1d1f; line-height: 1.6; white-space: pre-wrap;">${msgPreview}</p>
              </div>
              <a href="${APP_URL}/admin.html"
                 style="display: inline-block; background: #0071e3; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">
                管理画面で返信する →
              </a>
            </div>
          </div>
        `,
      }).catch(e => console.error('通知メール送信エラー:', e.message));
    }
  }

  record.directChatHistory = newMessages;
  saveDB(db);
  res.json({ success: true });
});

// ===== AI Chat =====
app.post('/api/chat', async (req, res) => {
  const { customer, messages, token } = req.body;

  if (!GEMINI_API_KEY) {
    return res.json({ error: 'APIキーが設定されていません' });
  }

  // ブロック済みチェック
  if (token) {
    const db = loadDB();
    const record = db[token];
    if (record && (record.status === 'blocked' || record.status === 'withdrawn')) {
      return res.json({ error: 'このサービスはご利用いただけません。' });
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    const custName = customer.name || '未入力';
    const customerContext = `
【お客様情報】
名前: ${custName}（※ 会話中は必ず「${custName}さん」と呼ぶこと。呼び捨て厳禁）
家族構成: ${customer.family || '未入力'}
世帯年収: ${customer.householdIncome || '未入力'}
物件種別: ${customer.propertyType || '未入力'}
登録目的: ${customer.purpose || '未入力'}
探索理由: ${customer.searchReason || '未入力'}
希望エリア: ${customer.area || '未入力'}
予算: ${customer.budget || '未入力'}
フリーコメント: ${customer.freeComment || ''}
メール: ${customer.email || '未入力'}
電話: ${customer.phone || '未入力'}
`.trim();

    // Build compact article list (titles only, no URLs - URLs resolved server-side)
    // カテゴリはカッコ内に入れ、AIが{{ARTICLE|タイトル}}で出力しやすい形式にする
    const articleListCompact = BLOG_ARTICLES.map(a => `「${a.title}」(${a.category})`).join('、');

    // ===== ハウスメーカー紹介・注文住宅 → 面談誘導プロンプト =====
    let housemaker_prompt = `\n【ハウスメーカー紹介・注文住宅に関する案内】
※注意: このセクションは「ハウスメーカー紹介」「注文住宅」に関する話題のみに適用する。
※「物件を探してほしい」「物件を紹介して」等の中古・新築の物件リクエストには絶対に適用しない。物件リクエストは上記の【★★★最優先ルール★★★】に従うこと。
お客様が以下のような発言をした場合に適用：
- 「ハウスメーカーを紹介してほしい」「おすすめのメーカーは？」
- 「紹介割引を受けたい」「紹介特典はある？」
- 「注文住宅を建てたい」「工務店を探している」
- 「優秀な担当者を紹介してほしい」
- 「記事で見た〇〇ハウスの紹介をお願いしたい」
- 「住宅展示場に行こうと思っている」「カタログ取り寄せたい」

■ 対応の基本姿勢：
お客様がハウスメーカーに興味を示している＝「いい担当者と繋がりたい」「どこが自分に合うか知りたい」という本質的なニーズを持っている。
いきなり面談を押し付けず、まずお客様の状況を理解すること。

★最重要★ 紹介ルートの価値を守る：
お客様が「カタログを取り寄せたい」「展示場に行こうと思っている」と言った場合、止める必要はないが、
その前に紹介を通すメリットを"情報として"自然に伝えること。
直接行ってしまうと紹介割引や優秀な担当者のマッチングが難しくなる場合があるため。
ただし、「行かないで！」「先に私を通して！」という言い方は絶対にNG。暑苦しさと嫌悪感につながる。

良い伝え方：
- 「展示場に行く前に、少しだけ知っておくと得する情報がありますよ。紹介ルートを使うと、担当者の質や条件が変わることがあるんです」
- 「もし気になるメーカーがあれば、事前にお伝えいただければ情報をお渡しできますよ。その上で展示場に行くとより有意義になると思います」
- 「カタログはもちろんご自由にですが、紹介経由だと担当者選びの段階から違いが出ることがあるので、先にお声がけいただけると良いかもしれません」

絶対にやってはいけない伝え方：
- 「展示場に直接行かないでください」←束縛
- 「まず私を通してからにしてください」←押しつけ
- 「紹介しないと損しますよ」←煽り
- 「絶対に紹介の方がいいです！」←断定・暑苦しい

■ 対応の流れ：

ステップ1: まず共感し、簡単にヒアリングする
「ハウスメーカー選びは本当に迷いますよね」
→ どのメーカーが気になっているか、何を重視しているかを聞く

ステップ2: 紹介の仕組みを"さらっと"説明する（一人称「私」で話すこと）
- 私は複数のハウスメーカーと提携していること
- 紹介を通すことで担当者の質が変わったり、割引が適用される場合があること
- ただし、お客様の状況（土地の有無・予算・家族構成等）によって最適なメーカーが異なること
※ 説明は簡潔に。メリットを並べすぎるとセールス感が出る。

ステップ3: オンライン面談を"自然に"提案する
※ 心理的ハードルを下げる配慮を忘れないこと

良い例（お客様の状況に合わせて1つ選ぶ）：
- 「${customer.name || 'お客様'}さんのご状況を少しお聞きできると、より合ったメーカーをご案内できます。15分ほどのオンラインで、気軽な感じで大丈夫ですよ」
- 「紹介割引の条件はメーカーごとに異なるので、一度お話しして整理できると安心かと思います。"まだ決めてない"段階でもまったく問題ありません」

悪い例（使わないこと）：
- 「オンライン面談が必須です」（強制感）
- 「ぜひ一度お話しさせてください！」（熱すぎる）
- 「面談していただかないと紹介できません」（条件付き感）
- 面談のメリットを3つも4つも並べる（セールス感）

ステップ4: お客様が肯定した場合のみ予約リンクを表示
{{BOOKING|${TIMEREX_URL}}}

■ 重要な注意：
- お客様が「今はまだいい」「考えます」と言ったら、即座に引き下がる
- その場合も突き放さず、別の切り口で価値提供を続ける（関連記事の紹介、他の疑問への回答など）
- 同じ会話で面談の再提案はしない
- お客様の登録目的が「ハウスメーカー紹介・割引を受けたい」の場合、初回メッセージで軽く触れてもOKだが、いきなり面談リンクは出さない`;

    // Check which fields are empty/未入力 for natural info gathering
    const emptyFields = [];
    const priorityFields = ['area', 'budget', 'family', 'propertyType', 'purpose', 'timeline', 'occupation', 'income'];
    priorityFields.forEach(field => {
      if (!customer[field] || customer[field] === '未入力' || customer[field] === '') {
        emptyFields.push(field);
      }
    });

    let missingInfoPrompt = '';
    if (emptyFields.length > 0) {
      const nextMissing = emptyFields[0];
      const fieldLabels = {
        'area': 'エリア',
        'budget': '予算',
        'family': '家族構成',
        'timeline': '購入希望時期',
        'propertyType': '物件種別（戸建て・マンション・注文住宅など）',
        'purpose': '登録のきっかけ・目的',
        'occupation': '職業',
        'income': '年収'
      };
      missingInfoPrompt = `\n【自然な情報収集】
会話の中で「${fieldLabels[nextMissing]}」について自然に聞いてください。
- 別の質問として浮かないよう、会話の流れに組み込んでください
- 1レスポンスに1つの未入力フィールドまでにしてください
- お客様が話題を続けている場合は、今の話題を優先してください`;
    }

    // TERASS Picksプロンプトは廃止。物件リクエスト対応はsystemPrompt内セクションFに統合済み。
    // TERASS Picks情報カード（{{TERASS_PICKS}}）はフロントエンドに残存させるが、プロンプトでは必須にしない。
    let terass_picks_prompt = '';

    const systemPrompt = `あなたは「岡本岳大」の分身AIアシスタント「MuchiNavi」です。
岡本はTERASS所属の個人エージェントで「本当のお客様ファースト」を実現しています。
あなたの役割はお客様の住まい探しの「味方」であり続けることです。

【根本思想：インサイト営業】
ドリルではなく穴を売れ——いや、穴すらまだ売り手視点。お客様が「なぜその穴が必要なのか」心理まで遡る。
物件や面談を売り込むのではなく、お客様の暮らしの課題を洞察し、価値を創造する存在であれ。
※ 一人称は「私」。「TERASS」「弊社」「当社」を主語にしない。

【★★★ 最優先ルール（プロンプト全体で最も重要） ★★★】
お客様が物件情報を求めた場合（「物件を探して」「物件を紹介して」「物件情報が欲しい」「ダイレクトチャットで送って」等）：
→ 必ず「ダイレクトチャット（個人チャット）でお送りしますね」と案内する
→ 暮らしのイメージを1-2個聞く（「新しい住まいでどんな暮らしをイメージされていますか？」等）
→ 応答の最終行に {{PROPERTY_REQUEST|条件とニーズの要約}} を必ず出力する
→ 面談提案・{{BOOKING}}・TERASS Picks案内は物件リクエストへの応答では絶対にしない
→ 「チャットでは物件情報を送れません」「面談が必要です」は絶対に言わない

${customerContext}

【基本ルール】
- 日本語のみで回答。外国語禁止。
- お客様の名前には必ず「さん」を付ける。呼び捨て厳禁。
- 一人称は「私」。「TERASS」「弊社」を主語にしない。
  ○「私がお調べします」 ×「TERASSでは〜」「弊社では〜」

【営業哲学 — お客様理解の技法】

■ 信頼構築が最優先
信頼されていない状態で知識をひけらかすのは逆効果。まず以下を徹底：
1. 感謝と共感を先に伝える
2. お客様の話に本気で興味を持つ
3. お客様の判断や行動をリスペクトする
4. 「○○さんだからこそ」の特別感を出す
5. 接触回数を重ねる（チャットでの継続対話も含む）
6. マジックフレーズ:「正直に申し上げると」「○○さんの場合は」

■ ニーズの3層構造（ヒアリングの核心）
お客様の発言は常に3層で捉える：
- 表面ニーズ（手段の手段）:「駅近マンションが欲しい」
- 中間ニーズ（手段）:「通勤を楽にしたい」
- 潜在ニーズ/インサイト（目的）:「家族との時間を増やしたい」
Whyを繰り返して上流の目的に辿り着くことで、本当に合う提案ができる。
ただしWhyの連発は尋問になる。「ちなみに」「というのは」で自然に掘る。

■ 顧客の3タイプを見極める
1. イメージ明確型 → 条件整理を手伝い、素早く具体提案へ
2. 優柔不断堅実型 → 判断基準を一緒に作る。選択肢を絞って提示
3. お金心配先行型 → まず資金面の不安を解消。ライフプラン視点で安心感を

■ 購買意欲の3ステップ（押し売り厳禁）
1. 信頼関係を築く（←ここを飛ばすと全て逆効果）
2. 不満・不安・課題を一緒に整理する（問題提起）
3. 解決策としての暮らしイメージを共有する
→ お客様が「自分で選んだ」と感じることが鉄則。急かすクロージングはキャンセルの鉄板コース。

■ 4つの不（追客の核心）
お客様が動かない理由は必ずこの4つのどれか：
- 不信:「この人/会社、大丈夫？」→ 信頼構築で解消
- 不要:「今じゃなくてもいい」→ 時間軸の課題を可視化
- 不適:「自分に合わない気がする」→ パーソナライズした提案
- 不急:「急いでない」→ 市場タイミング情報を自然に提供

【会話スタイル】
丁寧かつ自然な「です・ます」調。専門用語はわかりやすく。回答は適度な長さで箇条書きも活用。
結論ファースト + 例え話で具体化。長文の物件説明は禁止。

■ 書き出しルール（厳守）：
以下の冒頭フレーズは一切禁止（AI感が強いため）：
「素敵ですね！」「なるほど！」「承知しました！」「ありがとうございます！」「いい質問ですね！」
「おっしゃる通り！」「そうなんですね！」「かしこまりました！」「了解です！」

正しい書き出し：お客様の直前の発言に具体的に触れ、自分の言葉で受け止めてから回答に入る。
○「小学校の入学って、住まいを決める大きなタイミングですよね。学区のことも含めて逆算して考えていきましょうか。」
×「なるほど、お子様の入学に合わせたいんですね！」（オウム返し＋定型）

■ イエスマン禁止：
お客様の希望を安易に全肯定しない。リスクや見落としがあれば正直に伝える。
ただし否定ではなく「一緒に考えましょう」のスタンス。
○「駅近で庭付き、理想的ですよね。ただ正直に申し上げると、その条件を3000万円台で全部満たすのはエリアによっては厳しい場合もあります。○○さんの中で一番譲れないポイントはどこですか？」
×「いいですね！探してみましょう！」（全肯定＝無責任）

■ 締め方ルール：
会話が活発なとき → 提案で終わる（潜在ニーズの深掘り・記事紹介・選択肢提示）
会話を切り上げたいサイン（短い返事・「また今度」・反応が薄い）→ 質問を追加せず軽い締めで。
しつこく質問を続けるのは絶対NG。いつでも戻って来られる空気感を大切に。

■ エリア×予算×広さの3軸相反：
条件が全部は叶わないケースでは、3軸の相反関係を「例え話」で伝え、優先順位の整理を手伝う。

【★★★ 最優先ルール ★★★ 物件リクエスト対応 — 他の全てのルールより優先】
お客様が「物件を探してほしい」「物件を紹介して」「物件情報が欲しい」「先に物件だけ見たい」「ダイレクトチャットで送って」と言った場合、
以下の手順を必ず実行すること。TERASS Picksの案内や面談誘導よりもこちらを優先する。

■ 絶対禁止（1つでも違反したら失格）：
- 「面談が必要です」「面談で設定します」「オンラインで条件を整理しましょう」と面談に誘導すること
- 「TERASS Picksの設定には面談が必要」と伝えること
- 「このチャットでは物件情報を提供できません」と拒否すること
- {{BOOKING}} タグを物件リクエストへの応答で出すこと
- 物件リクエストに対してTERASS Picksカードを表示すること

■ 必ず実行する対応フロー：
1. 最初に「○○さんの条件に合いそうな物件情報、私の方からダイレクトチャット（個人チャット）でお送りしますね」と必ず伝える
2. その上で、暮らしのイメージ（潜在ニーズ）を1-2個だけ自然に聞く：
   - 「ちなみに、新しい住まいでどんな暮らしをイメージされていますか？」
   - 「今のお住まいで"ここが変わったらいいな"と思うことってありますか？」
3. 応答テキストの一番最後の行に、必ず {{PROPERTY_REQUEST|ニーズ要約}} を出力する

■ {{PROPERTY_REQUEST}} タグ（必須・省略厳禁）：
物件リクエストを受けたら、応答の最終行に以下を必ず出力する：
{{PROPERTY_REQUEST|ニーズ要約}}
ニーズ要約にはお客様の条件・希望・暮らしイメージを簡潔に含める。
出力例：{{PROPERTY_REQUEST|吹田市・3LDK・駅10分以内・学区重視・子どもの教育環境を大切にしたい}}
出力例：{{PROPERTY_REQUEST|大阪市内駅近・予算4000万・通勤時間短縮が最優先・今の賃貸が手狭}}

【禁止事項】
- 「物件情報をお送りします」→ 正しくは「ダイレクトチャットでお送りしますね」（個人チャットへの誘導）
- 「岡本から連絡します」→ お客様から面談予約 or ダイレクトチャットが正しい流れ
- 具体的な物件の提案や価格の断定
- 面談を断られた時に「ご自身で情報収集を」と突き放すこと

■ 紹介ルートの保護（全物件種別共通）：
以下は紹介割引・担当者マッチングの機会を潰すため禁止：
- 「カタログを取り寄せてみてください」「住宅展示場に行ってみてください」
- 「直接メーカーに問い合わせてみてください」「SUUMOで探してみてください」
→ 正しくは：「気になるメーカーがあればお伝えいただければ情報をお渡しできますよ」
→ 正しくは：「展示場に行く前に少し情報を整理しておくと比較しやすくなります」
紹介のメリットは"情報として"自然に伝える。「まず私を通して」「紹介しないと損」は厳禁。

【会話の流れ】
1. お客様の疑問・不安に丁寧に答える
2. ニーズの3層を意識して潜在ニーズを掘り下げる
3. 関連するブログ記事を紹介して理解を深めてもらう
4. 信頼関係が築けたタイミングで、面談 or ダイレクトチャットを提案

■ 深掘り質問（CHOICESタグ）：
抽象的な質問（「〜について教えて」等）には、まず短く共感し選択肢を提示：
{{CHOICES|選択肢1|選択肢2|選択肢3|選択肢4}}
選択肢は3-4個。具体的な質問やタップ後はそのまま回答。

■ ストレステスト4象限で深掘り：
- 具体化:「具体的にはどんなイメージですか？」
- 顕在化:「それって今どのくらい困っていますか？」
- 場合分け:「もし○○だったらどうしますか？」
- 深掘り:「それはなぜですか？（Whyの自然な言い換え）」

■ ブログ記事紹介：回答に関連する記事を最大2つ紹介可能。
フォーマット（厳守）：{{ARTICLE|記事タイトル}}
※ 記事タイトルのみ。カテゴリ名やカッコは含めない。
利用可能な記事: ${articleListCompact}

【面談予約ルール】
フォーマット：{{BOOKING|${TIMEREX_URL}}}

■ {{BOOKING}}タグを表示してよい条件：
お客様が面談に肯定的な返事をした場合のみ（「お願いします」「やってみたい」等）。

■ 面談の提案（リンクなし）をしてよいタイミング：
- まずお客様の質問・悩みに丁寧に回答した上で提案すること（いきなり面談提案は禁止）
- 「○○さんの場合、一度お話しすると解決できることも多いかもしれません。15分のオンライン面談はいかがですか？」
- 提案はあくまで選択肢の一つ。「面談しなければダメ」は厳禁
- この段階では{{BOOKING}}リンクは出さない

■ 面談を断られた場合（最重要）：
絶対禁止：「ご自身で情報収集を」「お気持ちが変わったら」「面談の話を繰り返す」
正しい対応：
1. 「もちろんです！○○さんのペースで大丈夫ですよ」と意思を尊重
2. 即座に別の切り口で価値提供（潜在ニーズの深掘り・記事紹介・ダイレクトチャット案内）
3. 「個人チャットでもやり取りできますので、テキストの方がお気軽であればそちらもぜひ」
4. あくまで「味方であり続ける」姿勢を貫く

${missingInfoPrompt}
${terass_picks_prompt}
${housemaker_prompt}

【★★★ 最終リマインダー（全ルールの中で最優先） ★★★】
お客様が「物件を探してほしい」「物件を紹介して」「物件情報が欲しい」「ダイレクトチャットで送って」と言った場合：
1. 必ず「ダイレクトチャット（個人チャット）でお送りしますね」と案内する
2. 暮らしのイメージを1-2個聞く
3. 応答の最終行に {{PROPERTY_REQUEST|ニーズ要約}} を必ず出力する
4. 面談提案・BOOKINGリンク・TERASS Picks案内は絶対にしない`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    });

    const geminiHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    const lastMessage = messages[messages.length - 1].content;

    // Perplexity APIで最新情報を補完（必要な場合のみ）
    let enrichedMessage = lastMessage;
    const perplexityQuery = detectRealtimeInfoNeed(lastMessage);
    if (perplexityQuery) {
      const latestInfo = await searchPerplexity(perplexityQuery);
      if (latestInfo) {
        enrichedMessage = `${lastMessage}\n\n【最新ファクトデータ（Perplexity API取得・2026年時点）— 以下の数値が正です】\n${latestInfo}\n\n【重要指示】\n- 金利・価格・税制などの数値は、上記ファクトデータの数値をそのまま使用してください\n- あなた自身の学習データの数値は古い可能性があるため、絶対に使用しないでください\n- 上記データに記載のない数値は「具体的な数値は岡本にお聞きください」と案内してください\n- 数値を引用する際は末尾に「（2026年3月時点の情報です。最新は金融機関にご確認ください）」と添えてください\n- むちのちとして自然で親しみやすい口調で回答してください`;
      }
    }

    // Add timeout to Gemini API call (25 seconds)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 25000)
    );
    const result = await Promise.race([
      chat.sendMessage(enrichedMessage),
      timeoutPromise,
    ]);
    let reply = result.response.text();

    // Filter out non-Japanese characters (Bengali, Cyrillic, Arabic, Thai, Devanagari, Korean)
    // Combined into single regex for efficiency, then clean up whitespace artifacts
    reply = reply.replace(/[\u0400-\u04FF\u0600-\u06FF\u0900-\u09FF\u0E00-\u0E7F\u1100-\u11FF\uAC00-\uD7AF]/g, '');
    // Clean up whitespace artifacts left by character removal
    reply = reply.replace(/[ \t]{2,}/g, ' ');        // collapse multiple spaces
    reply = reply.replace(/^ +| +$/gm, '');           // trim each line
    reply = reply.replace(/\n{3,}/g, '\n\n').trim();  // collapse multiple newlines

    // Resolve article titles to full URLs (AI only outputs title, server adds URL)
    reply = reply.replace(/\{\{ARTICLE\|(.+?)\}\}/g, (match, title) => {
      // AIがカテゴリ名を含めてしまった場合に除去（例：「記事タイトル【loan】」→「記事タイトル」）
      const cleanTitle = title.replace(/【.+?】/g, '').replace(/\(.+?\)/g, '').replace(/「|」/g, '').trim();

      // 完全一致 → 部分一致
      const article = BLOG_ARTICLES.find(a =>
        a.title === cleanTitle || a.title === title ||
        cleanTitle.includes(a.title) || a.title.includes(cleanTitle) ||
        title.includes(a.title) || a.title.includes(title)
      );
      if (article) {
        return `{{ARTICLE|${article.title}|${article.url}}}`;
      }
      // Fuzzy match by keywords
      const fuzzy = BLOG_ARTICLES.find(a => a.keywords.some(k => cleanTitle.includes(k) || title.includes(k)));
      if (fuzzy) {
        return `{{ARTICLE|${fuzzy.title}|${fuzzy.url}}}`;
      }
      return ''; // No match found, remove the tag
    });

    // === 物件リクエスト検出: ユーザーメッセージが物件を求めている場合、BOOKINGとTERASS_PICKSを強制除去 ===
    const propertyKeywords = ['物件を探し', '物件を紹介', '物件情報', 'ダイレクトチャットで送', '個人チャットで送', '物件だけ', '先に物件'];
    const isPropertyRequest = propertyKeywords.some(kw => lastMessage.includes(kw));
    if (isPropertyRequest) {
      // Geminiが無視してBOOKINGやTERASS_PICKSを出した場合、サーバー側で強制除去
      reply = reply.replace(/\{\{BOOKING\|[\s\S]*?\}\}/g, '');
      reply = reply.replace(/\{\{TERASS_PICKS\|[\s\S]*?\}\}/g, '');
      // 「チャットでは物件情報を送れません」系の文言も除去
      reply = reply.replace(/チャット(機能)?では[、,]?(個別の)?物件情報を(直接)?お(送り|伝え)することが(できない|難しい)[^。]*。/g, '');
      reply = reply.replace(/このチャットでは具体的な物件情報を直接お伝えすることができません。/g, '');
      // PROPERTY_REQUESTタグがなければサーバー側で自動生成
      if (!reply.includes('{{PROPERTY_REQUEST|')) {
        const autoSummary = `${customer.area || '未入力'}・${customer.propertyType || '未入力'}・予算${customer.budget || '未入力'}・${customer.family || '未入力'}`;
        reply = reply.trim() + `\n\n{{PROPERTY_REQUEST|${autoSummary}}}`;
        console.log(`🏠 物件リクエスト検出（サーバー側自動生成）: ${customer.name || '未入力'}さん`);
      }
      // ダイレクトチャット案内がなければ追加
      if (!reply.includes('ダイレクトチャット') && !reply.includes('個人チャット')) {
        reply = reply.replace(/^/, `${customer.name || 'お客様'}さんの条件に合いそうな物件情報、私の方からダイレクトチャット（個人チャット）でお送りしますね。\n\n`);
      }
    }

    // === PROPERTY_REQUEST検出 + 岡本への通知メール ===
    const propertyRequestMatch = reply.match(/\{\{PROPERTY_REQUEST\|(.+?)\}\}/);
    if (propertyRequestMatch) {
      const needsSummary = propertyRequestMatch[1];
      const customerName = customer.name || '名前未登録';
      const customerArea = customer.area || '未入力';
      const customerBudget = customer.budget || '未入力';
      const customerEmail = customer.email || '未入力';
      const customerPhone = customer.phone || '未入力';

      const recentChat = messages.slice(-5).map(m =>
        `${m.role === 'user' ? '顧客' : 'AI'}: ${(m.content || '').slice(0, 150)}`
      ).join('\n');

      sendNotificationEmail({
        to: NOTIFY_EMAIL,
        subject: `🏠 ${customerName}さんが物件情報をリクエストしました`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #fff; padding: 20px 24px; border-radius: 16px 16px 0 0;">
              <h2 style="margin: 0; font-size: 18px;">🏠 物件リクエスト</h2>
              <p style="margin: 8px 0 0; font-size: 13px; opacity: 0.9;">ダイレクトチャットで物件情報を送ってください</p>
            </div>
            <div style="background: #fff; border: 1px solid #e5e5ea; border-top: none; padding: 24px; border-radius: 0 0 16px 16px;">
              <p style="margin: 0 0 6px; font-size: 13px; color: #86868b;">お客様</p>
              <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #1d1d1f;">${customerName}さん</p>
              <p style="margin: 0 0 6px; font-size: 13px; color: #86868b;">潜在ニーズ・条件（AI分析）</p>
              <div style="background: #fff3cd; border-radius: 12px; padding: 16px; margin: 0 0 16px; border-left: 4px solid #ffc107;">
                <p style="margin: 0; font-size: 15px; color: #1d1d1f; line-height: 1.6;">${needsSummary}</p>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 16px;">
                <div><p style="margin: 0 0 4px; font-size: 12px; color: #86868b;">エリア</p><p style="margin: 0; font-size: 14px; color: #1d1d1f;">${customerArea}</p></div>
                <div><p style="margin: 0 0 4px; font-size: 12px; color: #86868b;">予算</p><p style="margin: 0; font-size: 14px; color: #1d1d1f;">${customerBudget}</p></div>
                <div><p style="margin: 0 0 4px; font-size: 12px; color: #86868b;">メール</p><p style="margin: 0; font-size: 14px; color: #1d1d1f;">${customerEmail}</p></div>
                <div><p style="margin: 0 0 4px; font-size: 12px; color: #86868b;">電話</p><p style="margin: 0; font-size: 14px; color: #1d1d1f;">${customerPhone}</p></div>
              </div>
              <p style="margin: 0 0 6px; font-size: 13px; color: #86868b;">直近の会話</p>
              <div style="background: #f5f5f7; border-radius: 12px; padding: 16px; margin: 0 0 20px;">
                <pre style="margin: 0; font-size: 13px; color: #1d1d1f; line-height: 1.6; white-space: pre-wrap; font-family: inherit;">${recentChat}</pre>
              </div>
              <a href="${APP_URL}/admin.html" style="display: inline-block; background: #f5576c; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">ダイレクトチャットで返信する →</a>
            </div>
          </div>`,
      }).catch(e => console.error('物件リクエスト通知メール送信エラー:', e.message));

      // タグをレスポンスから除去（お客様には見せない）
      reply = reply.replace(/\{\{PROPERTY_REQUEST\|.+?\}\}/g, '').trim();
      console.log(`🏠 物件リクエスト検出: ${customerName}さん → メール通知送信`);
    }

    // Save chat history to DB
    if (token) {
      const db = loadDB();
      if (db[token]) {
        db[token].chatHistory = messages.concat([{ role: 'assistant', content: reply }]);
        saveDB(db);
      }
    }

    res.json({ reply });
  } catch (e) {
    console.error('❌ AI チャットエラー:', e.message);
    const msg = e.message || '';
    if (msg === 'TIMEOUT') {
      res.json({ error: '回答の生成に時間がかかっています。もう一度お試しください。' });
    } else if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      res.json({ error: 'しばらくお待ちください。もう一度お試しいただけますか？' });
    } else {
      res.json({ error: '一時的なエラーが発生しました。再度お試しください。' });
    }
  }
});

// ===== Admin認証ミドルウェア =====
function adminAuth(req, res, next) {
  const pass = req.headers['x-admin-pass'];
  if (!pass || pass !== ADMIN_PASS) {
    return res.status(401).json({ error: '認証エラー: パスワードが正しくありません' });
  }
  next();
}

// ===== 管理API: お客様一覧 =====
app.get('/api/admin/customers', adminAuth, (req, res) => {
  const db = loadDB();
  const customers = Object.entries(db).map(([token, record]) => ({
    token,
    name: record.name || '-',
    email: record.email || '-',
    phone: record.phone || '-',
    family: record.family || '-',
    area: record.area || '-',
    budget: record.budget || '-',
    status: record.status || 'active',
    createdAt: record.createdAt || null,
    blockedAt: record.blockedAt || null,
    withdrawnAt: record.withdrawnAt || null,
    messageCount: (record.chatHistory || []).length,
    directChatCount: (record.directChatHistory || []).length,
    tags: record.tags || [],
    stage: parseInt(record.stage, 10) || 1,
  }));
  res.json({ customers });
});

// ===== 管理API: ブロック =====
app.post('/api/admin/block/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });

  record.status = 'blocked';
  record.blockedAt = new Date().toISOString();
  saveDB(db);
  console.log(`🚫 ブロック: ${record.name} (${req.params.token.substring(0, 8)}...)`);
  res.json({ success: true, message: `${record.name}さんをブロックしました` });
});

// ===== 管理API: ブロック解除 =====
app.post('/api/admin/unblock/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });

  record.status = 'active';
  record.blockedAt = null;
  saveDB(db);
  console.log(`✅ ブロック解除: ${record.name} (${req.params.token.substring(0, 8)}...)`);
  res.json({ success: true, message: `${record.name}さんのブロックを解除しました` });
});

// ===== 管理API: 削除 =====
app.delete('/api/admin/customer/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });

  const name = record.name;
  delete db[req.params.token];
  saveDB(db);
  console.log(`🗑️ 削除: ${name} (${req.params.token.substring(0, 8)}...)`);
  res.json({ success: true, message: `${name}さんのデータを完全に削除しました` });
});

// ===== 管理API: パスワード変更 =====
app.post('/api/admin/change-password', adminAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '現在のパスワードと新しいパスワードが必要です' });
  }

  if (currentPassword !== ADMIN_PASS) {
    return res.status(401).json({ error: '現在のパスワードが正しくありません' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: '新しいパスワードは4文字以上である必要があります' });
  }

  ADMIN_PASS = newPassword;
  saveSettings();
  console.log('🔐 管理者パスワードが変更されました');
  res.json({ success: true, message: 'パスワードが正常に変更されました' });
});

// ===== 管理API: 個人チャットメッセージを取得 =====
app.get('/api/admin/direct-chat/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  res.json({ messages: record.directChatHistory || [] });
});

// ===== 管理API: 個人チャットメッセージを送信 =====
app.post('/api/admin/direct-chat/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  const { message, file } = req.body;
  if ((!message || !message.trim()) && !file) return res.status(400).json({ error: 'empty message' });

  const trimmedMsg = (message || '').trim();
  if (!record.directChatHistory) record.directChatHistory = [];
  const msgObj = {
    role: 'agent',
    content: trimmedMsg,
    timestamp: new Date().toISOString()
  };
  if (file) msgObj.file = file;
  record.directChatHistory.push(msgObj);
  saveDB(db);

  // お客様へメール通知（メールアドレスがある場合）
  const customerEmail = record.email;
  const customerName = record.name || 'お客様';
  if (customerEmail) {
    const msgPreview = trimmedMsg.slice(0, 300);
    sendNotificationEmail({
      to: customerEmail,
      subject: `📩 岡本からメッセージが届いています`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
          <div style="background: linear-gradient(135deg, #34c759 0%, #30d158 100%); color: #fff; padding: 20px 24px; border-radius: 16px 16px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">📩 新しいメッセージ</h2>
            <p style="margin: 8px 0 0; font-size: 13px; opacity: 0.9;">岡本岳大｜住宅購入エージェント</p>
          </div>
          <div style="background: #fff; border: 1px solid #e5e5ea; border-top: none; padding: 24px; border-radius: 0 0 16px 16px;">
            <p style="margin: 0 0 4px; font-size: 13px; color: #86868b;">${customerName}さんへ</p>
            <div style="background: #f0f7ff; border-radius: 12px; padding: 16px; margin: 12px 0 20px;">
              <p style="margin: 0; font-size: 15px; color: #1d1d1f; line-height: 1.6; white-space: pre-wrap;">${msgPreview}</p>
            </div>
            <a href="${APP_URL}"
               style="display: inline-block; background: #34c759; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">
              MuchiNaviで確認する →
            </a>
            <p style="margin: 16px 0 0; font-size: 11px; color: #86868b; line-height: 1.5;">
              ※ このメールはMuchiNaviからの自動通知です。返信はMuchiNaviアプリ内のチャットからお願いします。
            </p>
          </div>
        </div>
      `,
    }).catch(e => console.error('顧客通知メール送信エラー:', e.message));
  }

  res.json({ success: true });
});

// ===== お客様自身による退会 =====
app.post('/api/withdraw/:token', (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'アカウントが見つかりません' });

  if (record.status === 'withdrawn') {
    return res.json({ success: true, message: 'すでに退会済みです' });
  }

  record.status = 'withdrawn';
  record.withdrawnAt = new Date().toISOString();
  record.chatHistory = []; // チャット履歴を削除
  record.directChatHistory = []; // 個人チャット履歴を削除
  saveDB(db);
  console.log(`👋 退会: ${record.name} (${req.params.token.substring(0, 8)}...)`);
  res.json({ success: true, message: 'ご利用ありがとうございました。退会処理が完了しました。' });
});

// ===== 管理API: タグ管理 =====
app.get('/api/admin/tags', adminAuth, (req, res) => {
  const data = loadTags();
  res.json(data);
});

app.post('/api/admin/tags', adminAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'タグ名を入力してください' });
  const data = loadTags();
  if (data.tags.some(t => t.name === name.trim())) {
    return res.status(400).json({ error: '同名のタグが既に存在します' });
  }
  const tag = { id: `tag_${Date.now()}`, name: name.trim(), color: color || '#0071e3', category: req.body.category || '' };
  data.tags.push(tag);
  saveTags(data);
  console.log(`🏷️ タグ作成: ${tag.name}`);
  res.json({ success: true, tag });
});

app.delete('/api/admin/tags/:id', adminAuth, (req, res) => {
  const data = loadTags();
  const tag = data.tags.find(t => t.id === req.params.id);
  if (!tag) return res.status(404).json({ error: 'タグが見つかりません' });
  // 全顧客からこのタグを除去
  const db = loadDB();
  Object.values(db).forEach(record => {
    if (record.tags && record.tags.includes(tag.name)) {
      record.tags = record.tags.filter(t => t !== tag.name);
    }
  });
  saveDB(db);
  data.tags = data.tags.filter(t => t.id !== req.params.id);
  saveTags(data);
  console.log(`🏷️ タグ削除: ${tag.name}`);
  res.json({ success: true });
});

// ===== 管理API: 顧客タグ更新 =====
app.put('/api/admin/customer/:token/tags', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'not found' });
  record.tags = req.body.tags || [];
  saveDB(db);
  res.json({ success: true, tags: record.tags });
});

// ===== 管理API: ブロードキャスト =====
app.get('/api/admin/broadcasts', adminAuth, (req, res) => {
  const data = loadBroadcasts();
  // 新しい順
  res.json({ broadcasts: (data.broadcasts || []).slice().reverse() });
});

app.post('/api/admin/broadcasts/preview', adminAuth, (req, res) => {
  const { filterType, tags } = req.body;
  const db = loadDB();
  const all = Object.entries(db);
  const matched = filterCustomersByTags(all, filterType || 'all', tags || []);
  res.json({
    matchCount: matched.length,
    customers: matched.map(([token, r]) => ({ token, name: r.name || '未入力', email: r.email || '' })),
  });
});

app.post('/api/admin/broadcasts/send', adminAuth, async (req, res) => {
  const { message, filterType, tags } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'メッセージを入力してください' });

  const db = loadDB();
  const all = Object.entries(db);
  const matched = filterCustomersByTags(all, filterType || 'all', tags || []);

  if (matched.length === 0) return res.status(400).json({ error: '配信対象のお客様がいません' });

  const broadcastId = `bcast_${Date.now()}`;
  const now = new Date().toISOString();
  const msgText = message.trim();

  // 各顧客のdirectChatHistoryに追加 + メール通知
  const emailPromises = [];
  for (const [token, record] of matched) {
    if (!record.directChatHistory) record.directChatHistory = [];
    record.directChatHistory.push({
      role: 'agent',
      content: msgText,
      timestamp: now,
      broadcastId,
    });

    if (record.email) {
      emailPromises.push(
        sendNotificationEmail({
          to: record.email,
          subject: '📢 岡本からのお知らせ',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
              <div style="background: linear-gradient(135deg, #0071e3 0%, #0055cc 100%); color: #fff; padding: 20px 24px; border-radius: 16px 16px 0 0;">
                <h2 style="margin: 0; font-size: 18px;">📢 お知らせ</h2>
                <p style="margin: 8px 0 0; font-size: 13px; opacity: 0.9;">岡本岳大｜住宅購入エージェント</p>
              </div>
              <div style="background: #fff; border: 1px solid #e5e5ea; border-top: none; padding: 24px; border-radius: 0 0 16px 16px;">
                <p style="margin: 0 0 4px; font-size: 13px; color: #86868b;">${record.name || 'お客様'}さんへ</p>
                <div style="background: #f0f7ff; border-radius: 12px; padding: 16px; margin: 12px 0 20px;">
                  <p style="margin: 0; font-size: 15px; color: #1d1d1f; line-height: 1.6; white-space: pre-wrap;">${msgText.length > 500 ? msgText.slice(0, 500) + '...' : msgText}</p>
                </div>
                <a href="${APP_URL}" style="display: inline-block; background: #0071e3; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">
                  MuchiNaviで確認する →
                </a>
              </div>
            </div>
          `,
        }).catch(e => console.error('ブロードキャストメール失敗:', record.email, e.message))
      );
    }
  }

  saveDB(db);

  // 配信履歴保存
  const bData = loadBroadcasts();
  bData.broadcasts.push({
    id: broadcastId,
    sentAt: now,
    message: msgText,
    filterType: filterType || 'all',
    filterTags: tags || [],
    recipientCount: matched.length,
    recipientTokens: matched.map(([t]) => t),
  });
  saveBroadcasts(bData);

  // メール送信（ベストエフォート）
  await Promise.allSettled(emailPromises);

  console.log(`📢 ブロードキャスト送信: ${matched.length}人 / ID: ${broadcastId}`);
  res.json({ success: true, broadcastId, sentCount: matched.length });
});

// ===== チェックリストテンプレート（11フェーズ77項目） =====
const CHECKLIST_TEMPLATE = [
  { name: '反響対応（初回問い合わせ）', items: [
    { title: '問い合わせ内容を正確に記録', detail: '氏名・連絡先・希望条件・問い合わせ経路を記録', ref: 'DAY3' },
    { title: '初回返信（5分以内目標）', detail: '迅速かつ丁寧な返信。自己紹介と次のステップを提案', ref: 'DAY3' },
    { title: 'お客様の温度感を把握', detail: '購入時期・緊急度・他社検討状況をヒアリング', ref: 'DAY3' },
    { title: '希望条件の概要把握', detail: 'エリア・価格帯・間取り・こだわりポイントを確認', ref: 'DAY3' },
    { title: 'CRM/顧客管理への登録', detail: 'お客様情報をシステムに登録し管理開始', ref: 'DAY3' },
    { title: '次回アクションの設定', detail: '面談日程の提案または次回連絡日を約束', ref: 'DAY3' },
    { title: 'お礼メール送信', detail: '問い合わせへのお礼と有益な情報を添えたメール', ref: 'DAY3' },
  ]},
  { name: '面談・案内準備', items: [
    { title: 'お客様情報の事前リサーチ', detail: '勤務先・年収推定・家族構成から最適提案を準備', ref: 'DAY4' },
    { title: '希望エリアの相場調査', detail: '直近の成約事例・相場推移・将来性を調査', ref: 'DAY4' },
    { title: '提案物件の事前選定（3〜5件）', detail: 'お客様の条件に合う物件を複数ピックアップ', ref: 'DAY4' },
    { title: '物件資料の準備', detail: '図面・写真・周辺情報をまとめた資料を作成', ref: 'DAY4' },
    { title: '住宅ローンの事前シミュレーション', detail: '想定借入額・月々返済額・金利タイプ別の比較', ref: 'DAY4' },
    { title: '面談場所・オンライン環境の確認', detail: '対面の場合は場所予約、オンラインはURL送付', ref: 'DAY4' },
    { title: 'アジェンダの作成', detail: '面談の流れ・確認事項・提案内容をリスト化', ref: 'DAY4' },
    { title: 'リマインド連絡', detail: '面談前日にリマインドメール or メッセージ', ref: 'DAY4' },
    { title: '競合物件・他社情報の把握', detail: '同エリアの競合物件や他社の動向を確認', ref: 'DAY4' },
    { title: '質問リストの準備', detail: 'お客様に確認すべき深掘り質問を準備', ref: 'DAY4' },
  ]},
  { name: '初回商談', items: [
    { title: '自己紹介とサービス説明', detail: 'TERASSの強み・自分の実績・サポート体制を説明', ref: 'DAY5' },
    { title: 'お客様の購入動機の深掘り', detail: 'なぜ今購入を考えているか、背景を丁寧にヒアリング', ref: 'DAY5' },
    { title: '資金計画の概要説明', detail: '購入に必要な費用の全体像を説明', ref: 'DAY5' },
    { title: 'ライフプランのヒアリング', detail: '将来の家族計画・転職予定・教育方針を確認', ref: 'DAY5' },
    { title: '購入の流れ説明', detail: '物件探し→内見→申込→契約→決済の流れを図解', ref: 'DAY5' },
    { title: '希望条件の優先順位付け', detail: 'MUST条件とWANT条件を分けて整理', ref: 'DAY5' },
    { title: '次回のアクションプラン提示', detail: '物件見学の日程・準備事項を具体的に提案', ref: 'DAY5' },
    { title: '面談議事録の作成・共有', detail: '話した内容をまとめてお客様に共有', ref: 'DAY5' },
    { title: 'お礼・フォローメール', detail: '面談のお礼と次のステップを記載したメール送付', ref: 'DAY5' },
  ]},
  { name: 'ヒアリング（ニーズ把握）', items: [
    { title: '現在の住まいの不満点', detail: '今の住まいで困っていること・改善したい点', ref: 'DAY5' },
    { title: '理想の暮らしイメージ', detail: '休日の過ごし方・通勤時間・子育て環境など', ref: 'DAY5' },
    { title: '絶対に譲れない条件', detail: '立地・間取り・設備のマスト条件を明確化', ref: 'DAY5' },
    { title: '妥協できるポイント', detail: '優先度が低い条件を把握して選択肢を広げる', ref: 'DAY5' },
    { title: '世帯年収・貯蓄の確認', detail: '無理のない予算設定のために正確に把握', ref: 'DAY5' },
    { title: '住宅ローンの事前審査状況', detail: '審査済み/未着手/不安要素を確認', ref: 'DAY5' },
    { title: '購入希望時期の確認', detail: '引越し希望日から逆算してスケジュール作成', ref: 'DAY5' },
    { title: '配偶者・家族の意向確認', detail: '決定権者は誰か、家族の意見を確認', ref: 'DAY5' },
    { title: 'ヒアリングシートの完成', detail: '全情報を体系的に整理して社内共有', ref: 'DAY5' },
  ]},
  { name: '物件案内', items: [
    { title: '内見スケジュール調整', detail: '候補物件3〜5件の効率的な内見ルート作成', ref: 'DAY6' },
    { title: '各物件のメリット・デメリット整理', detail: 'お客様の条件に照らした客観的な比較表', ref: 'DAY6' },
    { title: '周辺環境の下見', detail: 'スーパー・学校・病院・駅までの実際の動線確認', ref: 'DAY6' },
    { title: '内見時のチェックポイント説明', detail: '確認すべき構造・設備・日当たりなどをガイド', ref: 'DAY6' },
    { title: '内見後の感想ヒアリング', detail: '各物件の印象・気になった点を詳しく確認', ref: 'DAY6' },
    { title: '比較検討資料の作成', detail: '内見物件の比較表を作成しお客様に送付', ref: 'DAY6' },
    { title: '追加物件の提案', detail: 'フィードバックを踏まえた新たな候補物件の提案', ref: 'DAY6' },
  ]},
  { name: 'プレゼン・提案', items: [
    { title: '最終候補物件の絞り込み', detail: 'お客様と一緒に2〜3件に絞り込む', ref: 'DAY7' },
    { title: '詳細な資金計画書の作成', detail: '物件価格・諸費用・ローンシミュレーション', ref: 'DAY7' },
    { title: '住宅ローン比較表', detail: '金融機関別の金利・条件・審査基準の比較', ref: 'DAY7' },
    { title: 'ライフプランシミュレーション', detail: '将来の収支を含めた長期的な資金計画', ref: 'DAY7' },
    { title: '物件の将来価値分析', detail: 'エリアの発展性・資産価値の見通し', ref: 'DAY7' },
    { title: 'リスク説明', detail: '購入に伴うリスクと対策を正直に説明', ref: 'DAY7' },
    { title: '決断サポート', detail: '迷っているポイントを整理し判断材料を提供', ref: 'DAY7' },
  ]},
  { name: '購入手順説明', items: [
    { title: '購入申込書の説明', detail: '申込の意味・拘束力・キャンセルの可否', ref: 'DAY8' },
    { title: '手付金の説明', detail: '金額の目安・支払いタイミング・返還条件', ref: 'DAY8' },
    { title: '住宅ローン本審査の手続き', detail: '必要書類・審査期間・注意点を説明', ref: 'DAY8' },
    { title: '重要事項説明の予告', detail: '重説の内容・確認ポイントを事前に説明', ref: 'DAY8' },
    { title: '契約日程の調整', detail: '売主・買主・司法書士のスケジュール調整', ref: 'DAY8' },
    { title: '必要書類リストの送付', detail: '契約に必要な書類一覧をお客様に送付', ref: 'DAY8' },
  ]},
  { name: '重説・契約', items: [
    { title: '重要事項説明書の事前チェック', detail: '記載内容の確認・お客様への説明準備', ref: 'DAY9' },
    { title: '契約書の事前チェック', detail: '特約条項・引渡し条件・瑕疵担保の確認', ref: 'DAY9' },
    { title: '重要事項説明の実施', detail: '法定の重要事項をわかりやすく説明', ref: 'DAY9' },
    { title: '売買契約の締結', detail: '契約書への署名捺印・手付金の授受', ref: 'DAY9' },
    { title: '住宅ローン正式申込', detail: '金融機関への正式な融資申込手続き', ref: 'DAY9' },
    { title: '契約後のスケジュール共有', detail: '決済日までの流れとタスクを共有', ref: 'DAY9' },
  ]},
  { name: '決済・引渡し', items: [
    { title: '融資実行の確認', detail: '金融機関からの融資実行日・金額の最終確認', ref: 'DAY10' },
    { title: '残金決済の準備', detail: '必要書類・振込先・金額の最終確認', ref: 'DAY10' },
    { title: '物件の最終確認（引渡し前内覧）', detail: '契約時と相違ないか現地確認', ref: 'DAY10' },
    { title: '鍵の引渡し', detail: '鍵の受領・本数確認・管理説明', ref: 'DAY10' },
    { title: '引越し後の届出サポート', detail: '住所変更・転居届など必要手続きの案内', ref: 'DAY10' },
  ]},
  { name: 'アフターフォロー', items: [
    { title: '引渡し後1週間フォロー', detail: '不具合や困りごとがないか確認の連絡', ref: 'DAY11' },
    { title: '引渡し後1ヶ月フォロー', detail: '生活の中での気づき・相談に対応', ref: 'DAY11' },
    { title: '確定申告のリマインド', detail: '住宅ローン控除の申請方法と時期を案内', ref: 'DAY11' },
    { title: '定期的な状況確認', detail: '半年〜1年ごとに近況確認の連絡', ref: 'DAY11' },
    { title: '紹介依頼', detail: '満足いただけたら周りの方のご紹介をお願い', ref: 'DAY11' },
    { title: 'お客様の声の収集', detail: 'レビューやアンケートのお願い', ref: 'DAY11' },
  ]},
  { name: '追客（検討中顧客対応）', items: [
    { title: '定期的な情報提供', detail: '新着物件・相場情報・お役立ち記事を送付', ref: 'DAY11' },
    { title: 'ステータスの定期確認', detail: '購入意欲の変化・状況の変化をヒアリング', ref: 'DAY11' },
    { title: 'イベント・セミナー案内', detail: '住宅購入セミナーや内見会の案内', ref: 'DAY11' },
    { title: '条件変更のヒアリング', detail: '時間経過による希望条件の変化を確認', ref: 'DAY11' },
    { title: '再アプローチのタイミング判断', detail: '引越し時期・ライフイベントからベストタイミングを判断', ref: 'DAY11' },
  ]},
];

// ===== ヘルパー: 顧客コンテキスト生成 =====
function buildCustomerContext(record) {
  const cName = record.name || '未入力';
  let ctx = `【お客様情報】
名前: ${cName}（※「${cName}さん」と呼ぶこと）
生年月日: ${record.birthYear && record.birthMonth ? `${record.birthYear}年${record.birthMonth}月` : '未入力'}
年齢: ${record.age || '未入力'}歳
現在地: ${record.prefecture || '未入力'}
家族構成: ${record.family || '未入力'}
世帯年収: ${record.householdIncome || '未入力'}
現在の住まい: ${record.currentHome || '未入力'}
探索理由(登録時記入): ${record.searchReason || '未入力'}
引越し理由: ${record.reason || '未入力'}
物件種別: ${record.propertyType || '未入力'}
登録目的: ${record.purpose || '未入力'}
希望エリア: ${record.area || '未入力'}
予算: ${record.budget || '未入力'}
フリーコメント(登録時記入): ${record.freeComment || '未入力'}
希望広さ: ${record.size || '未入力'}
希望間取り: ${record.layout || '未入力'}
駅距離: ${record.stationDistance || '未入力'}
職業: ${record.occupation || '未入力'}
年収: ${record.income || '未入力'}
自己資金: ${record.savings || '未入力'}
ローン状況: ${record.loanStatus || '未入力'}
購入動機: ${record.motivation || '未入力'}
購入希望時期: ${record.timeline || '未入力'}
メール: ${record.email || '未入力'}
電話: ${record.phone || '未入力'}
LINE: ${record.line || '未入力'}
配偶者職業: ${record.spouseOccupation || '未入力'}
配偶者年収: ${record.spouseIncome || '未入力'}
現在の家賃: ${record.currentRent || '未入力'}
ペット: ${record.pet || '未入力'}
駐車場: ${record.parking || '未入力'}
こだわり条件: ${record.specialRequirements || '未入力'}
メモ: ${record.memo || '未入力'}`;

  const interactions = (record.interactions || []).slice(0, 10);
  if (interactions.length > 0) {
    ctx += '\n\n【直近のやり取り履歴】\n';
    interactions.forEach(i => { ctx += `${i.date} (${i.method}): ${i.content}\n`; });
  }

  const todos = record.todos || [];
  if (todos.length > 0) {
    ctx += '\n\n【現在のToDo】\n';
    todos.forEach(t => { ctx += `[${t.done ? '完了' : '未完了'}] ${t.priority || '中'} ${t.text}${t.deadline ? ` (期限: ${t.deadline})` : ''}\n`; });
  }

  const checklist = record.checklist;
  if (checklist) {
    let done = 0, total = 0;
    checklist.forEach(p => p.items.forEach(i => { total++; if (i.checked) done++; }));
    ctx += `\n\n【チェックリスト進捗】 ${done}/${total} 完了`;
  }

  // AIチャット履歴（直近20件）
  const chatHistory = (record.chatHistory || []).slice(-20);
  if (chatHistory.length > 0) {
    ctx += '\n\n【AIチャット履歴（MuchiNaviとのやり取り）】\n';
    chatHistory.forEach(m => {
      const role = m.role === 'user' ? 'お客様' : 'AI';
      const text = (m.content || m.parts?.[0]?.text || '').slice(0, 300);
      ctx += `${role}: ${text}\n`;
    });
  }

  // エージェント直接チャット履歴（直近15件）
  const directChat = (record.directChatHistory || []).slice(-15);
  if (directChat.length > 0) {
    ctx += '\n\n【エージェント直接チャット履歴（お客様↔岡本のやり取り）】\n';
    directChat.forEach(m => {
      const role = m.role === 'user' ? 'お客様' : '岡本(エージェント)';
      const text = (m.content || '').slice(0, 300);
      ctx += `${role}: ${text}\n`;
    });
  }

  return ctx;
}

// ===== 管理API: 顧客詳細取得 =====
app.get('/api/admin/customer/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  res.json({ customer: record });
});

// ===== 管理API: 顧客詳細更新 =====
app.put('/api/admin/customer/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });

  const updatable = ['name','birthYear','birthMonth','age','prefecture','family','householdIncome','currentHome','reason','searchReason','area','budget','freeComment','propertyType','purpose','size','layout','stationDistance','occupation','income','savings','loanStatus','motivation','timeline','email','phone','line','referral','spouseOccupation','spouseIncome','currentRent','pet','parking','specialRequirements','memo','stage','agentMemo','customerAdvice'];
  const updates = req.body;

  // Track old values for auto-tag update
  const oldPrefecture = record.prefecture;
  const oldPropertyType = record.propertyType;

  updatable.forEach(key => {
    if (updates[key] !== undefined) {
      record[key] = (key === 'stage') ? parseInt(updates[key], 10) : updates[key];
    }
  });

  // Auto-update tags if prefecture or propertyType changed
  if ((updates.prefecture && updates.prefecture !== oldPrefecture) ||
      (updates.propertyType && updates.propertyType !== oldPropertyType)) {
    const tagData = loadTags();
    if (!record.tags) record.tags = [];

    function ensureAutoTag(newVal, oldVal, color, category) {
      if (!newVal || newVal === '-' || newVal === '未入力') return;
      // Remove old auto-tag if it changed
      if (oldVal && oldVal !== newVal) {
        record.tags = record.tags.filter(t => t !== oldVal);
      }
      // Ensure tag exists in tag master
      const existingTag = tagData.tags.find(t => t.name === newVal);
      if (!existingTag) {
        tagData.tags.push({ id: 'tag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), name: newVal, color: color, category: category || '' });
      } else if (category && !existingTag.category) {
        existingTag.category = category;
      }
      // Add tag to customer if not already present
      if (!record.tags.includes(newVal)) {
        record.tags.push(newVal);
      }
    }

    if (updates.prefecture) ensureAutoTag(updates.prefecture, oldPrefecture, '#5856d6', '都道府県');
    if (updates.propertyType) ensureAutoTag(updates.propertyType, oldPropertyType, '#0071e3', '物件種別');
    saveTags(tagData);
  }

  saveDB(db);
  res.json({ success: true, message: '保存しました' });
});

// ===== 管理API: やり取り履歴 =====
app.get('/api/admin/interactions/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  res.json({ interactions: record.interactions || [] });
});

app.post('/api/admin/interactions/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!record.interactions) record.interactions = [];
  const interaction = { id: crypto.randomBytes(8).toString('hex'), ...req.body, createdAt: new Date().toISOString() };
  record.interactions.unshift(interaction);
  saveDB(db);
  res.json({ success: true, interaction });
});

app.delete('/api/admin/interaction/:token/:id', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  record.interactions = (record.interactions || []).filter(i => i.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ===== 管理API: TODO =====
app.get('/api/admin/todos/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  res.json({ todos: record.todos || [] });
});

app.post('/api/admin/todos/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!record.todos) record.todos = [];
  const todo = { id: crypto.randomBytes(8).toString('hex'), done: false, ...req.body, createdAt: new Date().toISOString() };
  record.todos.push(todo);
  saveDB(db);
  res.json({ success: true, todo });
});

app.put('/api/admin/todo/:token/:id', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  const todo = (record.todos || []).find(t => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: 'TODOが見つかりません' });
  Object.assign(todo, req.body);
  saveDB(db);
  res.json({ success: true, todo });
});

app.delete('/api/admin/todo/:token/:id', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  record.todos = (record.todos || []).filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ===== 管理API: チェックリスト =====
app.get('/api/admin/checklist/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  // チェックリスト未初期化の場合はテンプレートから生成
  if (!record.checklist) {
    record.checklist = JSON.parse(JSON.stringify(CHECKLIST_TEMPLATE)).map(phase => ({
      ...phase,
      items: phase.items.map(item => ({ ...item, checked: false, customized: '' })),
    }));
    saveDB(db);
  }
  res.json({ checklist: record.checklist });
});

app.put('/api/admin/checklist/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  record.checklist = req.body.checklist;
  saveDB(db);
  res.json({ success: true });
});

// ===== 管理API: エージェント相談チャット =====
app.post('/api/admin/chat-agent/:token', adminAuth, async (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!GEMINI_API_KEY) return res.json({ error: 'APIキーが設定されていません' });

  const { messages } = req.body;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const systemPrompt = `あなたは不動産仲介のプロフェッショナルアドバイザーです。
個人エージェントである岡本岳大さんの相談相手として、お客様対応のサポートをします。
必ず日本語のみで回答してください。

以下はこのお客様の全情報です：

${buildCustomerContext(record)}

岡本さんからの質問や相談に対して、以下の観点でアドバイスしてください：
- お客様の状況を踏まえた具体的な提案
- 次にやるべきこと（Next Action）
- 注意すべきポイントやリスク
- お客様の潜在的なニーズの仮説
- 物件提案のアイデア

回答は簡潔で実践的に。箇条書きも活用してOKです。
チャット中に具体的なToDoが出てきた場合は、最後に「【ToDo候補】」としてまとめてください。`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction: systemPrompt });
    const geminiHistory = messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const chat = model.startChat({ history: geminiHistory });
    const lastMessage = messages[messages.length - 1].content;

    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 25000));
    const result = await Promise.race([chat.sendMessage(lastMessage), timeoutPromise]);
    let reply = result.response.text();

    // Save agent chat history
    if (!record.agentChatHistory) record.agentChatHistory = [];
    record.agentChatHistory = messages.concat([{ role: 'assistant', content: reply }]);
    saveDB(db);

    res.json({ reply });
  } catch (e) {
    console.error('❌ エージェントチャットエラー:', e.message);
    res.json({ error: e.message === 'TIMEOUT' ? '回答の生成に時間がかかっています。' : '一時的なエラーが発生しました。' });
  }
});

// ===== 管理API: 顧客チャットプレビュー =====
app.post('/api/admin/chat-customer/:token', adminAuth, async (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!GEMINI_API_KEY) return res.json({ error: 'APIキーが設定されていません' });

  const { messages } = req.body;
  const customerName = record.name || 'お客様';
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const systemPrompt = `あなたは「岡本岳大」の分身AIアシスタントです。
岡本は不動産テック企業TERASSに所属する個人エージェントで、「本当の意味でのお客様ファースト」を実現しています。
必ず日本語のみで回答してください。

あなたは${customerName}様と会話しています。

以下はこのお客様の情報です：
${buildCustomerContext(record)}

会話のガイドライン：
- 温かく、誠実で、親しみやすい口調で「です・ます」調
- お客様の不安に寄り添い、安心感を提供
- 住宅購入に関する質問には正確に回答
- 専門用語はわかりやすく説明`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction: systemPrompt });
    const geminiHistory = messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const chat = model.startChat({ history: geminiHistory });
    const lastMessage = messages[messages.length - 1].content;

    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 25000));
    const result = await Promise.race([chat.sendMessage(lastMessage), timeoutPromise]);
    let reply = result.response.text();

    // Save customer chat history
    if (!record.customerChatHistory) record.customerChatHistory = [];
    record.customerChatHistory = messages.concat([{ role: 'assistant', content: reply }]);
    saveDB(db);

    res.json({ reply });
  } catch (e) {
    console.error('❌ 顧客チャットプレビューエラー:', e.message);
    res.json({ error: e.message === 'TIMEOUT' ? '回答の生成に時間がかかっています。' : '一時的なエラーが発生しました。' });
  }
});

// ===== 管理API: AI TODO提案 =====
app.post('/api/admin/suggest-todos/:token', adminAuth, async (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!GEMINI_API_KEY) return res.json({ error: 'APIキーが設定されていません' });

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });
    const prompt = `あなたは不動産仲介のトップエージェントの右腕です。岡本岳大さん（TERASS所属の個人エージェント）が、このお客様に対して「次に何をすべきか」を判断するための実行可能なToDoを3〜5個提案してください。

${buildCustomerContext(record)}

【分析の重視ポイント】
1. AIチャット履歴から読み取れるお客様の関心事・不安・温度感
2. エージェント直接チャットでの約束事・未対応事項
3. お客様の属性（予算・エリア・家族構成等）と現在の進捗
4. 既存ToDoの完了/未完了状況

【提案の基準】
- 顧客フェーズを見極める（情報収集期/比較検討期/物件見学期/購入決断期）
- チャットで出たが未対応の事項を最優先
- 漠然とした提案ではなく、何を・どうやって・なぜやるかが明確なもの

【出力形式】以下のJSON配列のみを出力。text/priority/reasonの各値は短く簡潔に（各50文字以内）。
[{"text":"ToDo内容","priority":"高","reason":"理由"}]`;

    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    // JSON配列部分を抽出
    let jsonStr = text;
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) jsonStr = arrMatch[0];

    // JSONパース試行（不正な制御文字を除去してリトライ）
    let suggestions;
    try {
      suggestions = JSON.parse(jsonStr);
    } catch (parseErr) {
      // 制御文字・不正なエスケープを除去して再試行
      const cleaned = jsonStr
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // 制御文字除去
        .replace(/,\s*([}\]])/g, '$1')       // trailing comma除去
        .replace(/([^\\])\\([^"\\\/bfnrtu])/g, '$1$2'); // 不正エスケープ除去
      try {
        suggestions = JSON.parse(cleaned);
      } catch (e2) {
        console.error('❌ JSON parse failed. Raw:', text.substring(0, 500));
        throw new Error('AIレスポンスのJSON解析に失敗しました');
      }
    }

    // 配列でなければ配列に変換
    if (!Array.isArray(suggestions)) {
      suggestions = suggestions.suggestions || suggestions.todos || [suggestions];
    }

    // 各項目を正規化
    suggestions = suggestions.slice(0, 5).map(s => ({
      text: String(s.text || s.todo || '').slice(0, 100),
      priority: ['高','中','低'].includes(s.priority) ? s.priority : '中',
      reason: String(s.reason || '').slice(0, 150),
    }));

    res.json({ suggestions });
  } catch (e) {
    console.error('❌ TODO提案エラー:', e.message);
    res.json({ error: 'AI提案の生成に失敗しました: ' + e.message });
  }
});

// ===== 管理API: やり取りAI分析 =====
app.post('/api/admin/analyze-interaction/:token', adminAuth, async (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!GEMINI_API_KEY) return res.json({ error: 'APIキーが設定されていません' });

  const { content } = req.body;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `あなたは不動産仲介のプロフェッショナルアドバイザーです。

${buildCustomerContext(record)}

以下のやり取り内容を分析して、気づき・重要ポイントと次のアクション候補をJSON形式で回答してください。

やり取り内容: ${content}

JSON形式（他のテキスト不要）:
{"insight": "気づき・重要ポイント", "suggestedTodos": [{"text": "アクション内容", "priority": "高/中/低"}]}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIレスポンスの解析に失敗');
    res.json(JSON.parse(jsonMatch[0]));
  } catch (e) {
    console.error('❌ やり取り分析エラー:', e.message);
    res.json({ error: 'AI分析に失敗しました: ' + e.message });
  }
});

// ===== 管理API: チャットから情報自動抽出 =====
app.post('/api/admin/extract-from-chat/:token', adminAuth, async (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });
  if (!GEMINI_API_KEY) return res.json({ error: 'APIキーが設定されていません' });

  const chatHistory = record.chatHistory || [];
  if (chatHistory.length === 0) {
    return res.json({ extracted: {} });
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const chatText = chatHistory.map(msg => `${msg.role === 'user' ? 'ユーザー' : 'AI'}: ${msg.content}`).join('\n');

    const prompt = `以下のチャット履歴から、お客様の情報を抽出してください。
実際に会話で言及されているもの「だけ」を抽出してください。推測や仮定は含めないでください。

【抽出対象フィールド】
age, family, currentHome, reason, area, budget, propertyType, size, layout, stationDistance, occupation, income, savings, loanStatus, motivation, timeline, spouseOccupation, spouseIncome, currentRent, pet, parking, specialRequirements

チャット履歴:
${chatText}

以下のJSON形式で回答（他のテキスト不要）:
{
  "age": "抽出値または null",
  "family": "抽出値または null",
  "currentHome": "抽出値または null",
  "reason": "抽出値または null",
  "area": "抽出値または null",
  "budget": "抽出値または null",
  "propertyType": "抽出値または null",
  "size": "抽出値または null",
  "layout": "抽出値または null",
  "stationDistance": "抽出値または null",
  "occupation": "抽出値または null",
  "income": "抽出値または null",
  "savings": "抽出値または null",
  "loanStatus": "抽出値または null",
  "motivation": "抽出値または null",
  "timeline": "抽出値または null",
  "spouseOccupation": "抽出値または null",
  "spouseIncome": "抽出値または null",
  "currentRent": "抽出値または null",
  "pet": "抽出値または null",
  "parking": "抽出値または null",
  "specialRequirements": "抽出値または null"
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIレスポンスの解析に失敗');

    const extracted = JSON.parse(jsonMatch[0]);
    // Remove null values to only keep extracted data
    Object.keys(extracted).forEach(key => {
      if (extracted[key] === null || extracted[key] === 'null') {
        delete extracted[key];
      }
    });

    res.json({ extracted });
  } catch (e) {
    console.error('❌ チャット情報抽出エラー:', e.message);
    res.json({ error: '情報抽出に失敗しました: ' + e.message });
  }
});

// ===== 管理API: 抽出情報を適用 =====
app.post('/api/admin/apply-extracted-info/:token', adminAuth, (req, res) => {
  const db = loadDB();
  const record = db[req.params.token];
  if (!record) return res.status(404).json({ error: 'お客様が見つかりません' });

  const { fields } = req.body;
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Invalid fields' });
  }

  // Only update empty/未入力 fields
  Object.keys(fields).forEach(key => {
    const currentValue = record[key];
    // Only update if field is empty or 未入力
    if (!currentValue || currentValue === '未入力' || currentValue === '') {
      record[key] = fields[key];
    }
  });

  saveDB(db);
  res.json({ success: true, message: '情報を適用しました' });
});

// ===== チェックリストテンプレート取得API =====
app.get('/api/admin/checklist-template', adminAuth, (req, res) => {
  res.json({ template: CHECKLIST_TEMPLATE });
});

// ===== 管理ページ =====
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===== Fallback to index.html (API以外のみ) =====
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== グローバルエラーハンドリング =====
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (!IS_PRODUCTION) console.error(err.stack);
  res.status(500).json({ error: IS_PRODUCTION ? 'サーバーエラーが発生しました' : err.message });
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

// ===== 管理者用: 記事を手動で再取得 =====
app.post('/api/admin/refresh-articles', adminAuth, async (req, res) => {
  try {
    await fetchBlogArticlesFromWP();
    res.json({ success: true, count: BLOG_ARTICLES.length, lastFetch: blogArticlesLastFetch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理者用: 現在の記事一覧を確認
app.get('/api/admin/articles', adminAuth, (req, res) => {
  res.json({
    count: BLOG_ARTICLES.length,
    lastFetch: blogArticlesLastFetch,
    categories: [...new Set(BLOG_ARTICLES.map(a => a.category))],
    articles: BLOG_ARTICLES.map(a => ({ category: a.category, title: a.title }))
  });
});

// ===== Start =====
app.listen(PORT, () => {
  const url = IS_PRODUCTION ? APP_URL : `http://localhost:${PORT}`;
  console.log(`
╔══════════════════════════════════════════╗
║   🏠 MuchiNavi Web Server               ║
║   ${url.padEnd(38)}║
║   ENV:  ${NODE_ENV.padEnd(33)}║
║   Gemini API:     ${(GEMINI_API_KEY ? '✅ 設定済み' : '❌ 未設定').padEnd(22)}║
║   Perplexity API: ${(PERPLEXITY_API_KEY ? '✅ 設定済み' : '⚠️ 未設定').padEnd(22)}║
║   SMTP:           ${(SMTP_USER ? '✅ 設定済み' : '⚠️ 未設定').padEnd(22)}║
╚══════════════════════════════════════════╝
  `);

  // サーバー起動後にWordPress記事を自動取得開始
  startBlogArticleSync();
});
