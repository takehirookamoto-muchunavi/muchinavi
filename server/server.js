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

// ===== メール送信ヘルパー =====
function createTransporter() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
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
        `${BLOG_WP_URL}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,link,categories,tags,status,date&status=publish&orderby=date&order=desc`
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

        const publishDate = post.date ? post.date.slice(0, 10) : ''; // YYYY-MM-DD
        allArticles.push({ category, title, url: post.link, keywords, publishDate });
      });

      page++;
      if (posts.length < 100) break;
    }

    if (allArticles.length > 0) {
      // 新しい記事が先に来るようにソート
      allArticles.sort((a, b) => (b.publishDate || '').localeCompare(a.publishDate || ''));
      BLOG_ARTICLES = allArticles;
      blogArticlesLastFetch = Date.now();
      console.log(`✅ WordPress記事取得完了: ${allArticles.length}本（${Object.keys(wpCategoryMap).length}カテゴリ）`);
      console.log(`📰 最新記事: ${allArticles[0]?.title} (${allArticles[0]?.publishDate})`);
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

// ===== Events Database =====
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
function loadEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
  } catch (e) { console.error('イベントDB読み込みエラー:', e.message); }
  return { events: [] };
}
function saveEvents(data) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ===== Processes Database =====
const PROCESSES_FILE = path.join(DATA_DIR, 'processes.json');
function loadProcesses() {
  try {
    if (fs.existsSync(PROCESSES_FILE)) return JSON.parse(fs.readFileSync(PROCESSES_FILE, 'utf-8'));
  } catch (e) { console.error('プロセスDB読み込みエラー:', e.message); }
  return { processes: [] };
}
function saveProcesses(data) {
  fs.writeFileSync(PROCESSES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ===== 取引プロセステンプレート =====
const PROCESS_STEP_TEMPLATE = {
  application: { label: '申込', docs: ['買付証明書'], agentTasks: ['物件の最終確認', '買付価格の相談', '売主側への提出'] },
  jusetsu_prep: { label: '重説準備', docs: ['物件概要書','登記簿謄本','建物図面','管理規約','重要事項説明書(下書き)'], agentTasks: ['物件調査','法令制限確認','重説書面作成'] },
  terass_application: { label: 'TERASS申請', docs: ['TERASS社内申請書','重要事項説明書'], agentTasks: ['申請書提出','社内承認待ち'] },
  jusetsu: { label: '重説実施', docs: ['重要事項説明書(最終版)'], agentTasks: ['お客様への説明実施','質疑応答','署名捺印'] },
  contract: { label: '契約', docs: ['売買契約書','手付金受領証'], agentTasks: ['契約書確認','特約条項確認','署名捺印立会い','手付金授受'] },
  loan_review: { label: 'ローン本審査', docs: ['ローン申込書','源泉徴収票','住民票','印鑑証明'], agentTasks: ['金融機関への申込','審査進捗フォロー','条件交渉'] },
  settlement: { label: '決済・引渡し', docs: ['残金','登記費用','鍵'], agentTasks: ['残金決済立会い','鍵引渡し確認','登記手続き確認','引越しフォロー'] }
};

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
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
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

  // ===== Slack通知（メールとは独立して必ず送信） =====
  try {
    const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
    const slackMessage = {
      text: `🏠 *新規登録* | ${customer.name}さん`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🏠 新規お客様が登録しました', emoji: true }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*お名前:*\n${customer.name || '-'}` },
            { type: 'mrkdwn', text: `*メール:*\n${customer.email || '-'}` },
            { type: 'mrkdwn', text: `*希望エリア:*\n${customer.area || '-'}` },
            { type: 'mrkdwn', text: `*予算:*\n${customer.budget || '-'}` },
            { type: 'mrkdwn', text: `*物件種別:*\n${customer.propertyType || '-'}` },
            { type: 'mrkdwn', text: `*家族構成:*\n${customer.family || '-'}` },
            { type: 'mrkdwn', text: `*世帯年収:*\n${customer.householdIncome || '-'}` },
            { type: 'mrkdwn', text: `*登録目的:*\n${customer.purpose || '-'}` },
          ]
        },
        ...(customer.searchReason ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*探索理由:*\n${customer.searchReason}` }
        }] : []),
        ...(customer.freeComment ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*コメント:*\n${customer.freeComment}` }
        }] : []),
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `📅 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} | MuchiNavi自動通知` }
          ]
        }
      ]
    };
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    });
    console.log('✅ Slack通知送信完了');
  } catch (slackErr) {
    console.error('⚠️ Slack通知エラー:', slackErr.message);
  }

  // Send emails (non-blocking — registration always succeeds)
  try {
    if (SMTP_USER && SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        tls: { rejectUnauthorized: false },
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
        console.error('💡 SMTP設定を確認してください（ホスト: ' + SMTP_HOST + ', ユーザー: ' + SMTP_USER + '）');
        return res.json({ success: true, token, emailError: 'SMTP認証に失敗しました。メール設定を確認してください。' });
      }

      // ===== 1) お客様への登録完了メール =====
      if (customer.email) {
        // AIでお客様に最適な記事を選定
        let recommendedArticles = [];
        try {
          if (GEMINI_API_KEY) {
            const articleList = BLOG_ARTICLES.map((a, i) => `${i}: ${a.title}【${a.category}】(${a.publishDate || '不明'})`).join('\n');
            const customerProfile = `名前: ${customer.name}, 家族: ${customer.family || '未入力'}, 物件種別: ${customer.propertyType || '未入力'}, 目的: ${customer.purpose || '未入力'}, エリア: ${customer.area || '未入力'}, 予算: ${customer.budget || '未入力'}, 世帯年収: ${customer.householdIncome || '未入力'}, 探索理由: ${customer.searchReason || '未入力'}`;
            const articleGenAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = articleGenAI.getGenerativeModel({ model: 'gemini-2.0-flash', generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } });
            const result = await model.generateContent(`以下のお客様プロフィールに基づき、最も今読むべき・役立つ記事を3つ選んでください。お客様の状況、悩み、目的に寄り添った選定をしてください。関連性が同程度の場合は、公開日が新しい記事を優先してください。

お客様プロフィール: ${customerProfile}

記事一覧（番号: タイトル【カテゴリ】(公開日)）:
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
app.post('/api/direct-chat-history/:token', async (req, res) => {
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

      // Slack通知
      try {
        const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
        await fetch(SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `💬 ${customerName}さんからメッセージ`,
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: '💬 個人チャット：新着メッセージ', emoji: true }
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*送信者:*\n${customerName}さん` },
                  { type: 'mrkdwn', text: `*メール:*\n${record.email || '-'}` },
                ]
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `*メッセージ:*\n${msgPreview}` }
              },
              {
                type: 'context',
                elements: [
                  { type: 'mrkdwn', text: `📅 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} | MuchiNavi自動通知` }
                ]
              }
            ]
          }),
        });
        console.log('✅ チャットSlack通知送信完了');
      } catch (slackErr) {
        console.error('⚠️ チャットSlack通知エラー:', slackErr.message);
      }
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

    // Build compact article list (全記事、新しい順)
    const articleListCompact = BLOG_ARTICLES.map(a => `「${a.title}」(${a.category}, ${a.publishDate || ''})`).join('\n');

    // ===== ハウスメーカー紹介・注文住宅 → 面談誘導プロンプト =====
    let housemaker_prompt = `\n【ハウスメーカー紹介・注文住宅に関する案内】
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

    let terass_picks_prompt = `\n【TERASS Picksのご案内】
お客様が「物件を探したい」「どんな家があるか知りたい」「物件検索に困っている」「もっといろいろ見たい」「どうやって探すのか」などと言及したときに：

■ 紹介の流れ（この順番で丁寧に伝えること）：

ステップ1: まずツールの魅力を伝える
「実は、SUUMO・at home・レインズの物件情報をまとめて自動でお届けできる『TERASS Picks』というツールがあります」
→ ここで {{TERASS_PICKS}} カードを表示

ステップ2: なぜオンライン面談が必要かを丁寧に説明する
以下のポイントを自然な会話の中で伝える：
- TERASS Picksは、お客様一人ひとりの条件に合わせて設定するツールであること
- 「エリア・間取り・予算・築年数・駅距離」など、細かい条件を一緒に整理しながら設定する必要があること
- だからこそ、15分ほどのオンライン面談で「こんな条件で届けてほしい」をお伺いしたいこと
- 設定が完了すれば、あとは自動で新着物件が届くようになること

ステップ3: 面談のハードルを下げる一言を添える
例：
- 「15分ほどの短いお時間で設定できます」
- 「画面をお見せしながら一緒に条件を決められるので、難しいことはありません」
- 「もちろん、まだ条件がはっきりしていなくても大丈夫です。整理するところからお手伝いできます」

ステップ4: 予約リンクを表示
{{BOOKING|${TIMEREX_URL}}}

■ 重要な注意事項：
- この流れはあくまで「お客様が物件情報に興味を示した場合」のみ使うこと
- TERASS Picksの話題が出ていないのにオンライン面談を勧めるのは禁止
- 押し売り感を出さないこと。「ぜひ」「絶対」などの強い表現は避ける
- お客様が「今はいいです」「考えます」と言った場合は、すぐに引き下がること
- 一度の会話でTERASS Picksの案内は1回まで。断られた後に再度案内しないこと

【TERASS Picks情報カード】
AI が TERASS Picks について説明する場合、以下の形式を使用：
{{TERASS_PICKS|SUUMO、at home、レインズの情報をまとめて自動でお届け。お客様の条件に合わせて設定します|15分のオンライン面談で設定できます}}`;

    const systemPrompt = `あなたは「岡本岳大」の分身AIアシスタント「MuchiNavi」です。
岡本はTERASS所属の個人エージェントで「本当のお客様ファースト」を実現しています。
あなたの役割はお客様の住まい探しの「味方」であり続けることです。
※ お客様との会話では岡本の立場として「私」を一人称に使う。会社名「TERASS」や「弊社」を主語にしないこと。

${customerContext}

【重要ルール - 厳守】
- 必ず日本語のみで回答。外国語は絶対に使わない。
- お客様の名前には絶対に「さん」を付けること（例: 山田さん）。呼び捨ては厳禁。1回でも呼び捨てにしてはならない。
- 一人称は必ず「私」を使うこと。「TERASS」「弊社」「当社」を主語にしない。あくまで岡本個人として話す。
  ○ 「私がご紹介できます」「私の方でお調べします」
  × 「TERASSがご紹介します」「TERASSでは〜」「弊社では〜」

【岡本の人物像・話し方】
岡本は接客のプロフェッショナル。丁寧だが堅すぎず、お客様が「この人には本音を話せる」と感じる空気感を持つ。
テンプレ的な相槌は使わず、お客様が言った内容に具体的に触れることで「ちゃんと聞いている」と伝わる返し方をする。
お客様の希望や夢を安易に全肯定しない。不動産購入はお客様の人生を左右する決断であり、「いいですね！」と背中を押すだけでは無責任。
お客様が気づいていないリスクや見落としがあれば、正直に伝える。ただし否定ではなく「一緒に考えましょう」というスタンスで。

【会話ガイドライン】
- 丁寧かつ自然な「です・ます」調。不安に寄り添い、専門用語はわかりやすく。
- 回答は適度な長さで箇条書きも活用。
- 文章は途中で切らず、必ず完結させること。「例えば、」「具体的には、」で文が終わるのは禁止。
- 説明→問いかけ→選択肢 の順序を守り、各パートのつながりを自然にすること。

【★重要★ メッセージの書き出しルール】
■ 禁止する冒頭フレーズ（AI感・ロボット感が強いため）：
「素敵ですね！」「なるほど！」「承知しました！」「ありがとうございます！」「いい質問ですね！」
「おっしゃる通りですね！」「そうなんですね！」「かしこまりました！」「了解です！」
→ これらの定型フレーズから始めることは一切禁止。

■ 正しい書き出し方：
お客様の直前の発言内容に具体的に触れてから回答に入ること。相手の言葉をオウム返しするのではなく、自分の言葉で受け止め直す。

○ 良い例（お客様「子どもが小学校に上がるまでには引っ越したい」の場合）：
「小学校の入学って、住まいを決める大きなタイミングですよね。学区のことも含めて、逆算して考えていきましょうか。」

× 悪い例：
「なるほど、お子様の入学に合わせたいんですね！」（オウム返し＋定型相槌）
「素敵ですね！お子様のためにマイホームを考えていらっしゃるんですね！」（全肯定＋定型）

■ イエスマンにならない例：
お客様「駅近で庭付き一戸建て、3000万円台で探してます」の場合
× 「いいですね！探してみましょう！」（全肯定＝無責任）
× 「それは難しいと思います」（否定＝突き放し）
○ 「駅近で庭付き、すごく理想的ですよね。ただ正直に申し上げると、その条件を3000万円台で全部満たすのはエリアによってはかなり厳しい場合もあります。○○さんの中で一番譲れないポイントってどこですか？そこから優先順位を整理していくと、いい物件に出会いやすくなりますよ。」

【★最重要★ メッセージの締め方ルール】
基本的にはメッセージを「提案」で終わること。ただし、お客様が会話を終わらせたがっている場合は例外。

■ 会話を切り上げたいサインの例：
- 「ありがとうございます」「わかりました」だけの短い返事
- 「また聞きます」「また今度」「大丈夫です」
- 質問に対して「特にないです」「大丈夫です」
- 同じ話題が続いて反応が薄くなってきた
- 絵文字やスタンプだけの返信

→ このような場合は、質問や提案を追加せず「いつでもお気軽にどうぞ！」のような軽い締めでOK。
→ お客様がまた話したくなった時に自然に戻って来られる空気感を大切にすること。
→ しつこく質問を続けるのはストレスになるので絶対にNG。

■ 会話が活発なときの良い締め方の例：
- 「ちなみに、〇〇さんは△△という点は気になりますか？」（潜在ニーズの深掘り）
- 「こちらの記事も参考になるかもしれません」（ブログ記事の提案）
- 「ほかにも気になるテーマはありますか？」＋ 選択肢（{{CHOICES}}）で具体的に提示
- 「〇〇さんの状況だと、□□についても知っておくと安心かもしれません。詳しくお伝えしましょうか？」（次のアクション提案）

■ 禁止する締め方（会話が活発なとき）：
- 情報を伝えて終わり（提案なし）←お客様が次に何をすればいいかわからない。

【絶対にやってはいけないこと】
- 「物件情報をお送りします」「エリア情報をご連絡します」など、物件や具体的情報を後で送ると約束すること。このAIには物件情報を送る機能はありません。
- 「岡本から連絡します」「改めてご連絡します」という表現。お客様から面談予約をしていただく形が正しい流れです。
- 具体的な物件の提案や価格の断定。
- 面談を断られた時に「まずはご自身で情報収集を」「ご自身のペースで」など突き放すこと。絶対禁止。

【★重要★ 岡本の紹介を活かすスタンス】
お客様にとって最大のメリットは「岡本を通じた紹介」です。紹介によって優秀な担当者とのマッチング、紹介割引などの特典が得られます。
したがって以下の提案は、お客様の利益を損なうため絶対にしてはいけません：

■ 禁止する提案（全物件種別共通）：
- 「カタログを取り寄せてみてください」「資料請求してみましょう」←紹介割引が使えなくなる可能性
- 「住宅展示場に行ってみてください」「モデルルームを見学してみてはいかがですか」←お客様が直接行くと紹介ルートが使えなくなる
- 「直接メーカーに問い合わせてみてください」「不動産会社に相談してみては」←同上
- 「SUUMOやHOME'Sで探してみてください」「ポータルサイトで検索を」←仲介者を介さない行動を促すことになる

■ 正しいスタンス：
お客様が「どこに相談すればいいか」「どう動けばいいか」と迷っているときこそ、岡本がサポートできる場面。
ただし「私に任せて！」「まず私に相談して！」という押しつけがましさは絶対にNG。
お客様の意思を尊重しつつ、紹介のメリットを"情報"として自然に伝える。

良い例：
- 「○○さんの条件に合いそうなメーカーがいくつかありますので、よければ詳しくお伝えできますよ」
- 「ハウスメーカーは紹介ルートを通すと、担当者の質や条件面で違いが出ることがあるんですよ。気になるメーカーがあれば聞いてくださいね」
- 「展示場に行く前に、少し情報を整理しておくと比較しやすくなります。お手伝いできることがあればいつでもどうぞ」

悪い例：
- 「まずは私を通してください」←押しつけがましい
- 「他で相談しないでください」←束縛感
- 「紹介しないと損します」←煽り
- 「絶対に紹介の方がいいです」←断定的で暑苦しい

【正しい会話の流れ】
1. お客様の疑問・不安に丁寧に答える（知識面でのサポート）
2. 関連するブログ記事を紹介して理解を深めてもらう
3. お客様の状況に合わせた「次の提案」をする（記事紹介、深掘り質問、選択肢提示など）
4. 会話を重ねて信頼関係が築けたタイミングで、面談提案を行う（下記ルール参照）

【★重要★ 選択肢の提示ルール】
選択肢（{{CHOICES}}タグ）を使うときは、必ず以下のルールを守ること。

■ 選択肢を使うタイミング：
- 抽象的な質問（「〜について教えて」「何から始めれば」など）を受けたとき
- 説明の後に「お客様ならどうしたいか」を確認したいとき

■ 選択肢の前の文章（最重要）：
選択肢の直前には、必ず「完結した文章」で誘導すること。
文末が「例えば、」「たとえば」「具体的には、」のように途中で切れるのは絶対禁止。
お客様が「なぜこの選択肢が出てきたのか」を一瞬で理解できる、自然な問いかけ文で締めること。

○ 良い例（選択肢の直前の文）：
「〇〇さんは、どのあたりが気になりますか？」
「〇〇さんの場合、どれに近いですか？」
「気になるものがあればタップしてみてください。」
「〇〇さんが一番知りたいのはどれですか？」

× 悪い例（絶対禁止）：
「例えば、」← 文が途中で切れている
「たとえば以下のようなものがあります。」← 選択肢を"説明リスト"のように扱っている
「具体的には、」← 文が途中で切れている

■ フォーマット：
{{CHOICES|選択肢1|選択肢2|選択肢3|選択肢4}}
選択肢は3〜4個。各選択肢はお客様の気持ち・ニーズを代弁する短い文にする。

■ 選択肢タップ後の対応：
選択肢をタップした後は、その選択に対して具体的に回答する。再び抽象的な情報を繰り返さないこと。

【ブログ記事紹介】回答に関連する記事を最大2つ紹介可能。
フォーマット（厳守）：{{ARTICLE|記事タイトル}}
※記事タイトルのみを「」なしで入れること。カテゴリ名・日付・カッコは絶対に含めないこと。
例：{{ARTICLE|住宅ローンの基礎知識}}
★重要：お客様の悩み・質問内容に最も関連性の高い記事を選ぶこと。関連性が同程度なら新しい記事を優先。
利用可能な全記事（新しい順、タイトル, カテゴリ, 公開日）:
${articleListCompact}

【特別記事：優柔不断・堂々巡りへの処方箋】
以下の兆候がお客様の会話から感じられる場合に限り、この記事を紹介すること：
- 条件を全て叶えたいと言っているが決められない
- 同じ悩みを繰り返し相談している（堂々巡り）
- 「〇〇も気になるし、△△も捨てがたい」のように優柔不断な様子
- 検討期間が長くなりすぎて前に進めていない様子
- あれもこれもと条件が増え続けている

★この記事を紹介する場合の必須ルール：
1. いきなり記事を出さない。まずお客様の話を十分に聞き、共感すること
2. 記事を紹介する直前に必ず以下のような前置きを入れること：
「少し厳しい内容になるかもしれませんが、同じように悩まれた方の参考になった記事があります。〇〇さんにもヒントになるかもしれません。」
3. 記事紹介後は「もし読んでみて感じたことがあれば、いつでも話してくださいね」とフォローすること
4. 初回の会話や、まだ信頼関係が浅い段階では絶対に紹介しないこと。ある程度やり取りを重ねた後で紹介すること

フォーマット：{{ARTICLE|「青い鳥」を探すのはもう終わりにしませんか？一生マイホームが決まらない本当の理由}}

【面談予約リンクのルール】
フォーマット：{{BOOKING|${TIMEREX_URL}}}

■ 面談予約リンク（{{BOOKING}}タグ）を表示してよい条件：
→ お客様が面談に「肯定的な返事」をした場合のみ。
　例: 「お願いします」「やってみたい」「予約したい」「いいですね」「はい」など

■ 面談の「提案」（リンクなし）をしてよいタイミング：
AIから面談を提案すること自体はOK。ただし以下を守ること：
- まずお客様の質問・悩みに丁寧に回答した上で提案すること（いきなり面談提案は禁止）
- 提案文は「〇〇さんの場合、一度お話ししてみることで解決できることも多いかもしれません。15分程度のオンライン面談はいかがですか？」のように、お客様の状況に寄り添った形で
- 提案はあくまで選択肢の一つとして。「面談しなければダメ」というニュアンスは厳禁
- この段階ではまだ{{BOOKING}}リンクは出さない

■ お客様が面談を断った場合の対応（最重要）：
絶対にやってはいけないこと：
- 「まずはご自身で情報収集されてください」←突き放し。厳禁。
- 「お気持ちが変わったらいつでもどうぞ」←冷たい。禁止。
- 面談の話を何度もする←しつこい。禁止。

正しい対応：
1. 「もちろんです！〇〇さんのペースで大丈夫ですよ」と意思を尊重する
2. 即座に別の切り口で価値を提供する：
   - 「ちなみに〇〇さんは△△についてはどうお考えですか？」（潜在ニーズの深掘り）
   - 「こちらの記事が参考になるかもしれません」（ブログ記事の提案）
   - 「個人チャットでも岡本と直接やり取りできますので、テキストの方がお気軽であればそちらもぜひ」
3. あくまで「味方であり続ける」姿勢を貫く

■ TERASS Picksの案内の流れで表示する場合：
- お客様が物件情報に興味を示し、TERASS Picksを紹介する流れの中でのみ
- 「ツールの設定にはオンライン面談が必要」という文脈で自然に提示
- お客様が肯定した場合のみ{{BOOKING}}リンクを出す

■ ハウスメーカー紹介・注文住宅の相談の流れで表示する場合：
- お客様がハウスメーカー紹介、紹介割引、注文住宅の相談を希望している場合
- 「お客様に合ったメーカーをご紹介するために状況をお伺いしたい」という文脈で面談提案
- お客様が肯定した場合のみ{{BOOKING}}リンクを出す
- 心理的ハードルを下げる一言を必ず添える（短時間・気軽・未定でもOK）

${missingInfoPrompt}
${terass_picks_prompt}
${housemaker_prompt}`;

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

    // Add timeout to Gemini API call (25 seconds)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 25000)
    );
    const result = await Promise.race([
      chat.sendMessage(lastMessage),
      timeoutPromise,
    ]);
    let reply = result.response.text();

    // Filter out non-Japanese characters
    reply = reply.replace(/[\u0980-\u09FF]/g, '');
    reply = reply.replace(/[\u0400-\u04FF]/g, '');
    reply = reply.replace(/[\u0600-\u06FF]/g, '');
    reply = reply.replace(/[\u0E00-\u0E7F]/g, '');
    reply = reply.replace(/[\u0900-\u097F]/g, '');
    reply = reply.replace(/[\u1100-\u11FF\uAC00-\uD7AF]/g, '');
    reply = reply.replace(/\n{3,}/g, '\n\n').trim();

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
  const now = Date.now();
  const customers = Object.entries(db).map(([token, record]) => {
    // 最終連絡日の計算
    const interactions = record.interactions || [];
    const directChat = record.directChatHistory || [];
    let lastContactDate = null;

    // interactions は unshift で追加（先頭が最新）
    if (interactions.length > 0 && interactions[0].date) {
      lastContactDate = interactions[0].date;
    }

    // directChatHistory のエージェントメッセージ（時系列順、末尾が最新）
    const agentMessages = directChat.filter(m => m.role === 'agent');
    if (agentMessages.length > 0) {
      const lastAgentDate = agentMessages[agentMessages.length - 1].timestamp;
      if (!lastContactDate || new Date(lastAgentDate) > new Date(lastContactDate)) {
        lastContactDate = lastAgentDate;
      }
    }

    const hasContactHistory = interactions.length > 0 || agentMessages.length > 0;
    if (!lastContactDate) {
      lastContactDate = record.createdAt || null;
    }

    let daysSinceContact = null;
    if (lastContactDate) {
      daysSinceContact = Math.floor((now - new Date(lastContactDate).getTime()) / (1000 * 60 * 60 * 24));
    }

    // ToDo期限切れ計算
    const todos = record.todos || [];
    const todayStr = new Date().toISOString().split('T')[0];
    const overdueTodoCount = todos.filter(t => !t.done && t.deadline && t.deadline < todayStr).length;
    const pendingTodoCount = todos.filter(t => !t.done).length;

    return {
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
      lastContactDate,
      daysSinceContact,
      hasContactHistory,
      stageUpdatedAt: record.stageUpdatedAt || record.createdAt || null,
      overdueTodoCount,
      pendingTodoCount,
    };
  });
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
  const oldStage = parseInt(record.stage, 10) || 1;

  updatable.forEach(key => {
    if (updates[key] !== undefined) {
      record[key] = (key === 'stage') ? parseInt(updates[key], 10) : updates[key];
    }
  });

  // Track stage change for stageUpdatedAt
  if (updates.stage !== undefined) {
    const newStage = parseInt(updates.stage, 10);
    if (newStage !== oldStage) {
      record.stageUpdatedAt = new Date().toISOString();
    }
  }

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

// ========================================================
// ===== イベント（カレンダー）管理 API =====
// ========================================================

// イベント一覧取得
app.get('/api/admin/events', adminAuth, (req, res) => {
  const data = loadEvents();
  let events = data.events || [];
  const { from, to, customerToken } = req.query;
  if (from) events = events.filter(e => e.date >= from);
  if (to) events = events.filter(e => e.date <= to);
  if (customerToken) events = events.filter(e => e.customerToken === customerToken);
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.startTime || '').localeCompare(b.startTime || '');
  });
  res.json({ events });
});

// イベント作成
app.post('/api/admin/events', adminAuth, (req, res) => {
  const { type, title, customerToken, date, startTime, endTime, location, notes } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title と date は必須です' });
  const data = loadEvents();
  const event = {
    id: 'evt_' + crypto.randomBytes(8).toString('hex'),
    type: type || 'general',
    title,
    customerToken: customerToken || null,
    date,
    startTime: startTime || null,
    endTime: endTime || null,
    location: location || '',
    notes: notes || '',
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.events.push(event);
  saveEvents(data);
  res.json({ event });
});

// イベント更新
app.put('/api/admin/event/:id', adminAuth, (req, res) => {
  const data = loadEvents();
  const idx = data.events.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'イベントが見つかりません' });
  const allowed = ['type','title','customerToken','date','startTime','endTime','location','notes','status'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) data.events[idx][key] = req.body[key];
  });
  data.events[idx].updatedAt = new Date().toISOString();
  saveEvents(data);
  res.json({ event: data.events[idx] });
});

// イベント削除
app.delete('/api/admin/event/:id', adminAuth, (req, res) => {
  const data = loadEvents();
  const idx = data.events.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'イベントが見つかりません' });
  data.events.splice(idx, 1);
  saveEvents(data);
  res.json({ success: true });
});

// ========================================================
// ===== 取引進捗（プロセス）管理 API =====
// ========================================================

// プロセス一覧取得
app.get('/api/admin/processes', adminAuth, (req, res) => {
  const data = loadProcesses();
  let processes = data.processes || [];
  const { status, customerToken } = req.query;
  if (status) processes = processes.filter(p => p.status === status);
  if (customerToken) processes = processes.filter(p => p.customerToken === customerToken);
  res.json({ processes, stepTemplate: PROCESS_STEP_TEMPLATE });
});

// プロセス作成
app.post('/api/admin/processes', adminAuth, (req, res) => {
  const { customerToken, propertyName, propertyPrice } = req.body;
  if (!customerToken) return res.status(400).json({ error: 'customerToken は必須です' });
  const data = loadProcesses();
  const steps = {};
  Object.keys(PROCESS_STEP_TEMPLATE).forEach(key => {
    steps[key] = { status: 'pending', deadline: null, completedAt: null, notes: '' };
  });
  const proc = {
    id: 'proc_' + crypto.randomBytes(8).toString('hex'),
    customerToken,
    propertyName: propertyName || '',
    propertyPrice: propertyPrice || '',
    status: 'active',
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.processes.push(proc);
  saveProcesses(data);
  res.json({ process: proc });
});

// プロセスのステップ更新
app.put('/api/admin/process/:id/step/:key', adminAuth, (req, res) => {
  const data = loadProcesses();
  const proc = data.processes.find(p => p.id === req.params.id);
  if (!proc) return res.status(404).json({ error: 'プロセスが見つかりません' });
  const stepKey = req.params.key;
  if (!proc.steps[stepKey]) return res.status(400).json({ error: '無効なステップです' });
  const { status, deadline, notes } = req.body;
  if (status) {
    proc.steps[stepKey].status = status;
    if (status === 'completed') proc.steps[stepKey].completedAt = new Date().toISOString();
  }
  if (deadline !== undefined) proc.steps[stepKey].deadline = deadline;
  if (notes !== undefined) proc.steps[stepKey].notes = notes;
  proc.updatedAt = new Date().toISOString();
  // 全ステップ完了チェック
  const allDone = Object.values(proc.steps).every(s => s.status === 'completed');
  if (allDone) proc.status = 'completed';
  saveProcesses(data);
  res.json({ process: proc });
});

// プロセス削除
app.delete('/api/admin/process/:id', adminAuth, (req, res) => {
  const data = loadProcesses();
  const idx = data.processes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'プロセスが見つかりません' });
  data.processes.splice(idx, 1);
  saveProcesses(data);
  res.json({ success: true });
});

// ========================================================
// ===== 朝ブリーフィング API =====
// ========================================================

app.get('/api/admin/briefing', adminAuth, (req, res) => {
  const db = loadDB();
  const eventsData = loadEvents();
  const processesData = loadProcesses();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const weekLater = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

  const stageLabels = ['','登録','情報入力','面談予約','相談中','ライフプラン','物件探し・内見','契約','引渡し'];
  const STAGNATION = { 1:14, 2:14, 3:30, 4:30, 5:30, 6:45, 7:45 };

  // --- 顧客集計 ---
  const customers = [];
  let activeCount = 0;
  Object.entries(db).forEach(([token, record]) => {
    if (record.status === 'blocked' || record.status === 'withdrawn') return;
    activeCount++;
    // 最終連絡日計算
    let lastContactDate = null;
    if (record.interactions && record.interactions.length > 0) {
      lastContactDate = record.interactions[0].date;
    }
    if (record.directChatHistory) {
      const agentMsgs = record.directChatHistory.filter(m => m.role === 'agent');
      if (agentMsgs.length > 0) {
        const lastAgent = agentMsgs[agentMsgs.length - 1].timestamp;
        if (!lastContactDate || lastAgent > lastContactDate) lastContactDate = lastAgent;
      }
    }
    const daysSinceContact = lastContactDate ? Math.floor((today - new Date(lastContactDate)) / 86400000) : null;

    // ToDo集計
    const todos = (record.todos || []).filter(t => !t.done);
    const overdueTodos = todos.filter(t => t.deadline && t.deadline < todayStr);
    const todayTodos = todos.filter(t => t.deadline === todayStr);
    const weekTodos = todos.filter(t => t.deadline && t.deadline > todayStr && t.deadline <= weekLater);

    // ステージ滞留
    const stage = parseInt(record.stage) || 1;
    let stagnantDays = null;
    if (record.stageUpdatedAt && STAGNATION[stage]) {
      stagnantDays = Math.floor((today - new Date(record.stageUpdatedAt)) / 86400000);
    }

    customers.push({
      token, name: record.name || '(名前なし)', stage, stageLabel: stageLabels[stage] || '',
      email: record.email, phone: record.phone, line: record.line,
      budget: record.budget, area: record.area, propertyType: record.propertyType,
      lastContactDate, daysSinceContact,
      overdueTodos, todayTodos, weekTodos, allTodos: todos,
      stagnantDays, stagnationThreshold: STAGNATION[stage] || null,
      isStagnant: stagnantDays !== null && STAGNATION[stage] && stagnantDays >= STAGNATION[stage],
      memo: record.memo, agentMemo: record.agentMemo
    });
  });

  // --- 今日のイベント ---
  const todayEvents = (eventsData.events || [])
    .filter(e => e.date === todayStr && e.status === 'scheduled')
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  // 今週のイベント
  const weekEvents = (eventsData.events || [])
    .filter(e => e.date > todayStr && e.date <= weekLater && e.status === 'scheduled')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));

  // イベントに顧客名を付与
  const attachCustomerName = (evt) => {
    if (evt.customerToken) {
      const c = db[evt.customerToken];
      return { ...evt, customerName: c ? c.name : '(不明)' };
    }
    return { ...evt, customerName: null };
  };

  // --- 取引進捗サマリー ---
  const activeProcesses = (processesData.processes || []).filter(p => p.status === 'active');
  const processSummary = {};
  Object.keys(PROCESS_STEP_TEMPLATE).forEach(key => {
    processSummary[key] = { label: PROCESS_STEP_TEMPLATE[key].label, customers: [] };
  });
  activeProcesses.forEach(proc => {
    const c = db[proc.customerToken];
    const cName = c ? c.name : '(不明)';
    // 現在のステップ = 最初の未完了ステップ
    for (const [key, step] of Object.entries(proc.steps)) {
      if (step.status !== 'completed') {
        processSummary[key].customers.push({
          processId: proc.id, customerToken: proc.customerToken, customerName: cName,
          propertyName: proc.propertyName, deadline: step.deadline, status: step.status
        });
        break;
      }
    }
  });

  // プロセスの期限切れ/今日期限
  const processDeadlines = { overdue: [], today: [], week: [] };
  activeProcesses.forEach(proc => {
    const c = db[proc.customerToken];
    const cName = c ? c.name : '(不明)';
    Object.entries(proc.steps).forEach(([key, step]) => {
      if (step.status === 'completed' || !step.deadline) return;
      const item = { processId: proc.id, customerToken: proc.customerToken, customerName: cName,
        propertyName: proc.propertyName, stepLabel: PROCESS_STEP_TEMPLATE[key].label, deadline: step.deadline };
      if (step.deadline < todayStr) processDeadlines.overdue.push(item);
      else if (step.deadline === todayStr) processDeadlines.today.push(item);
      else if (step.deadline <= weekLater) processDeadlines.week.push(item);
    });
  });

  // --- 要対応アクション集約 ---
  const urgent = { overdue: [], today: [], week: [], followUp: [] };

  customers.forEach(c => {
    c.overdueTodos.forEach(t => urgent.overdue.push({ type: 'todo', customerName: c.name, customerToken: c.token, text: t.text, deadline: t.deadline, priority: t.priority }));
    c.todayTodos.forEach(t => urgent.today.push({ type: 'todo', customerName: c.name, customerToken: c.token, text: t.text, deadline: t.deadline, priority: t.priority }));
    c.weekTodos.forEach(t => urgent.week.push({ type: 'todo', customerName: c.name, customerToken: c.token, text: t.text, deadline: t.deadline, priority: t.priority }));
    if (c.daysSinceContact !== null && c.daysSinceContact >= 14) {
      urgent.followUp.push({ customerName: c.name, customerToken: c.token, daysSinceContact: c.daysSinceContact, stage: c.stage, stageLabel: c.stageLabel, isStagnant: c.isStagnant });
    }
    if (c.daysSinceContact === null && c.stage <= 3) {
      urgent.followUp.push({ customerName: c.name, customerToken: c.token, daysSinceContact: null, stage: c.stage, stageLabel: c.stageLabel, noContact: true });
    }
  });

  // プロセス期限もurgentに統合
  processDeadlines.overdue.forEach(p => urgent.overdue.push({ type: 'process', ...p }));
  processDeadlines.today.forEach(p => urgent.today.push({ type: 'process', ...p }));
  processDeadlines.week.forEach(p => urgent.week.push({ type: 'process', ...p }));

  // ソート: priority high > medium > low, 期限が近い順
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  const sortByUrgency = (a, b) => (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2) || (a.deadline || '').localeCompare(b.deadline || '');
  urgent.overdue.sort(sortByUrgency);
  urgent.today.sort(sortByUrgency);
  urgent.week.sort(sortByUrgency);
  urgent.followUp.sort((a, b) => (b.daysSinceContact || 999) - (a.daysSinceContact || 999));

  res.json({
    date: todayStr,
    dayOfWeek: ['日','月','火','水','木','金','土'][today.getDay()],
    stats: { totalActive: activeCount, totalCustomers: Object.keys(db).length },
    todayEvents: todayEvents.map(attachCustomerName),
    weekEvents: weekEvents.map(attachCustomerName),
    urgent,
    processSummary,
    activeProcessCount: activeProcesses.length
  });
});

// プロセステンプレート取得
app.get('/api/admin/process-template', adminAuth, (req, res) => {
  res.json({ template: PROCESS_STEP_TEMPLATE });
});

// ===== Start =====
app.listen(PORT, () => {
  const url = IS_PRODUCTION ? APP_URL : `http://localhost:${PORT}`;
  console.log(`
╔══════════════════════════════════════════╗
║   🏠 MuchiNavi Web Server               ║
║   ${url.padEnd(38)}║
║   ENV:  ${NODE_ENV.padEnd(33)}║
║   Gemini API: ${(GEMINI_API_KEY ? '✅ 設定済み' : '❌ 未設定').padEnd(26)}║
║   SMTP:       ${(SMTP_USER ? '✅ 設定済み' : '⚠️ 未設定').padEnd(26)}║
╚══════════════════════════════════════════╝
  `);

  // サーバー起動後にWordPress記事を自動取得開始
  startBlogArticleSync();
});
