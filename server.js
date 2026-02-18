require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const compression = require('compression');

const app = express();
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

// ===== Blog Articles Database =====
const BLOG_ARTICLES = [
  // --- 住宅ローン ---
  { category: 'loan', title: '住宅ローンの基本と選び方完全ガイド', url: 'https://muchinochi55.com/【2025年版】住宅ローンの基本と選び方完全ガイド/', keywords: ['住宅ローン', '選び方', '基本', '金利'] },
  { category: 'loan', title: '固定金利と変動金利どちらがいいのか', url: 'https://muchinochi55.com/【住宅ローンの『きほん』の『き』】固定金利と/', keywords: ['固定金利', '変動金利', '金利タイプ'] },
  { category: 'loan', title: '月々の返済額はいくらが理想？無理のない住宅ローン', url: 'https://muchinochi55.com/【完全解説】月々の返済額はいくらが理想？無理/', keywords: ['返済額', '月々', '無理のない'] },
  { category: 'loan', title: '住宅ローン審査に通りやすくなるコツ5選', url: 'https://muchinochi55.com/住宅ローン審査に通りやすくなるコツ5選｜30代フ/', keywords: ['審査', '通りやすい', 'コツ'] },
  { category: 'loan', title: '頭金ゼロでも家は買える？', url: 'https://muchinochi55.com/【賢く家を買う方法】頭金ゼロでも家は買える？/', keywords: ['頭金', 'ゼロ', '初期費用'] },
  { category: 'loan', title: 'ペアローンと連帯債務の違い', url: 'https://muchinochi55.com/ペアローンと連帯債務の違いとは？夫婦で選ぶべ/', keywords: ['ペアローン', '連帯債務', '夫婦', '共働き'] },
  { category: 'loan', title: 'フリーランスでも住宅ローンは組める！', url: 'https://muchinochi55.com/フリーランスでも住宅ローンは組める！審査通過/', keywords: ['フリーランス', '自営業', '審査'] },
  { category: 'loan', title: '住宅ローン控除の落とし穴', url: 'https://muchinochi55.com/住宅ローン控除の落とし穴｜資金計画で見落とし/', keywords: ['住宅ローン控除', '減税', '税金'] },
  { category: 'loan', title: '金利上昇リスクに備える住宅ローン対策', url: 'https://muchinochi55.com/金利上昇リスクに備える住宅ローン対策｜失敗し/', keywords: ['金利上昇', 'リスク', '対策'] },
  { category: 'loan', title: '団信とは？住宅ローンの生命保険', url: 'https://muchinochi55.com/団信とは？住宅ローンの生命保険のメリット・注/', keywords: ['団信', '生命保険', '保障'] },
  { category: 'loan', title: '転職中の住宅ローン返済', url: 'https://muchinochi55.com/【転職検討中の方必見！】住宅ローン返済中に転/', keywords: ['転職', 'ローン返済'] },
  { category: 'loan', title: '住宅ローン破綻を防ぐ方法', url: 'https://muchinochi55.com/住宅ローン破綻なんて怖くない！不動産のプロが/', keywords: ['破綻', '返済不能', '防ぐ'] },
  // --- ライフプラン ---
  { category: 'lifeplan', title: 'ライフプランを立てずに家を買うとどうなる？', url: 'https://muchinochi55.com/ライフプランを立てずに家を買うとどうなる？失/', keywords: ['ライフプラン', '失敗', '計画'] },
  { category: 'lifeplan', title: '共働き世帯のライフプラン作成が未来を決める', url: 'https://muchinochi55.com/【どれくらい考えていますか？】共働き世帯こそ/', keywords: ['共働き', 'ライフプラン', '家計'] },
  { category: 'lifeplan', title: '教育費と住宅ローンの賢い両立方法', url: 'https://muchinochi55.com/子供の進学を考えた家選び｜将来の教育費と住宅/', keywords: ['教育費', '子供', '進学', '両立'] },
  { category: 'lifeplan', title: '家を買っても旅行・外食を楽しむ暮らし', url: 'https://muchinochi55.com/家を買っても「旅行・外食」を楽しむ暮らしにす/', keywords: ['旅行', '外食', '生活の質', '楽しむ'] },
  { category: 'lifeplan', title: '老後の年金だけで大丈夫？', url: 'https://muchinochi55.com/【将来を見据えるのが重要！】老後の年金だけで/', keywords: ['老後', '年金', '将来'] },
  { category: 'lifeplan', title: '家計診断で無理のない住宅購入', url: 'https://muchinochi55.com/【将来をしっかり考える】家計診断で「無理のな/', keywords: ['家計診断', '無理のない', '購入額'] },
  { category: 'lifeplan', title: '賃貸vs購入どっちが得？30代ファミリー', url: 'https://muchinochi55.com/賃貸vs購入どっちが得？30代ファミリーの選び方完/', keywords: ['賃貸', '購入', '比較', '30代'] },
  { category: 'lifeplan', title: '転職・独立を見据えた家選び', url: 'https://muchinochi55.com/将来の転職・独立を見据えた家選びとは｜ライフ/', keywords: ['転職', '独立', '将来'] },
  // --- 家探し・物件選び ---
  { category: 'hunting', title: '家を買う前に絶対やるべき準備', url: 'https://muchinochi55.com/【知らないと大損も？】家を買う前に絶対やるべ/', keywords: ['準備', '買う前', '始め方'] },
  { category: 'hunting', title: '不動産購入の流れ7ステップ', url: 'https://muchinochi55.com/fudosan-purchase-flow-7steps/', keywords: ['購入の流れ', 'ステップ', '手順'] },
  { category: 'hunting', title: '家を買うタイミングはいつがベスト？', url: 'https://muchinochi55.com/家を買うタイミングはいつがベスト？後悔しない/', keywords: ['タイミング', 'いつ', '時期'] },
  { category: 'hunting', title: 'マイホーム購入でよくある不安と解消法', url: 'https://muchinochi55.com/【あなたはどうですか？】よくあるマイホーム購/', keywords: ['不安', '解消', 'よくある質問'] },
  { category: 'hunting', title: '内見で確認すべき10のポイント', url: 'https://muchinochi55.com/【保存版】家を買う前の内見で必ず確認すべき10の/', keywords: ['内見', 'チェック', '確認'] },
  { category: 'hunting', title: 'マイホームが決まらない理由と解決策', url: 'https://muchinochi55.com/myhome-kimaranai-riyuu-kaiketsu/', keywords: ['決まらない', '迷い', '解決'] },
  { category: 'hunting', title: '家探しで失敗しない3つのステップ', url: 'https://muchinochi55.com/家探し初心者必見！失敗しない3つのステップと成/', keywords: ['初心者', '失敗しない', 'ステップ'] },
  { category: 'hunting', title: '条件だけで家を選ぶと後悔する理由', url: 'https://muchinochi55.com/条件だけで家を選ぶと後悔する理由｜理想の暮ら/', keywords: ['条件', '後悔', '理想'] },
  { category: 'hunting', title: '新築vsリノベーション', url: 'https://muchinochi55.com/新築vsリノベーション｜後悔しない選び方と判断基/', keywords: ['新築', 'リノベーション', '中古', '比較'] },
  { category: 'hunting', title: 'マンションと戸建てどっちが正解？', url: 'https://muchinochi55.com/マンションと戸建てどっちが正解？後悔しない選/', keywords: ['マンション', '戸建て', 'どっち'] },
  { category: 'hunting', title: '勢いで家を買うは正解？', url: 'https://muchinochi55.com/【ちょっと待って！！】勢いで家を買うは正解？/', keywords: ['勢い', '即決', '慎重'] },
  { category: 'hunting', title: '中古物件の購入前に知るべきこと', url: 'https://muchinochi55.com/【超・重要】中古物件って実際どう？購入前に知/', keywords: ['中古', '注意点', '購入前'] },
  { category: 'hunting', title: '住宅展示場の賢い使い方', url: 'https://muchinochi55.com/住宅展示場って行く意味ある？後悔しないための5/', keywords: ['住宅展示場', '見学', 'ハウスメーカー'] },
  // --- ハウスメーカー・注文住宅 ---
  { category: 'housemaker', title: '注文住宅の予算オーバーを防ぐ方法', url: 'https://muchinochi55.com/chumon-jutaku-yosan-over/', keywords: ['注文住宅', '予算オーバー', 'コスト'] },
  { category: 'housemaker', title: 'ハウスメーカー選びは営業担当で決まる', url: 'https://muchinochi55.com/注文住宅は営業担当で決まる｜後悔しないため/', keywords: ['ハウスメーカー', '営業担当', '選び方'] },
  { category: 'housemaker', title: '土地と建築会社どちらを先に決める？', url: 'https://muchinochi55.com/custom-home-land-or-builder-first/', keywords: ['土地', '建築会社', '先に', '順番'] },
  { category: 'housemaker', title: '住友林業vs積水ハウス比較', url: 'https://muchinochi55.com/sumitomoringyou-sekisuihouse-comparison/', keywords: ['住友林業', '積水ハウス', '比較'] },
  { category: 'housemaker', title: '鉄骨vs木造の比較', url: 'https://muchinochi55.com/tetsukotsu-mokuzo-hikaku/', keywords: ['鉄骨', '木造', '構造', '比較'] },
  // --- エリアガイド ---
  { category: 'area-osaka', title: '大阪で子育てしやすい街ランキング', url: 'https://muchinochi55.com/大阪で子育てしやすい街ランキング【2025年版】～/', keywords: ['大阪', '子育て', 'ランキング'] },
  { category: 'area-osaka', title: '北摂エリアの住みやすさランキング', url: 'https://muchinochi55.com/hokusetsu-livability-ranking/', keywords: ['北摂', '住みやすさ', '吹田', '豊中'] },
  { category: 'area-osaka', title: '大阪転勤族の住む場所の選び方', url: 'https://muchinochi55.com/osaka-tenkin-sumubashoerabikata/', keywords: ['転勤', '大阪', '住む場所'] },
  { category: 'area-osaka', title: '大阪で新築戸建てを買うなら', url: 'https://muchinochi55.com/大阪で新築戸建てを買うなら？プロが選ぶ失敗し/', keywords: ['大阪', '新築', '戸建て'] },
  { category: 'area-tokyo', title: '東京23区で子育てにやさしい街ランキング', url: 'https://muchinochi55.com/東京23区で子育てにやさしい街ランキング2026年最/', keywords: ['東京', '23区', '子育て'] },
  { category: 'area-tokyo', title: '世田谷・杉並・練馬で迷ったら', url: 'https://muchinochi55.com/「どこで子育てする？」世田谷・杉並・練馬で迷/', keywords: ['世田谷', '杉並', '練馬', '比較'] },
  { category: 'area-tokyo', title: '23区か郊外かの選択', url: 'https://muchinochi55.com/「23区か？郊外か？」その選択が人生を左右する理/', keywords: ['23区', '郊外', '選択'] },
  // --- マンション ---
  { category: 'mansion', title: 'マンション購入時の管理費チェック', url: 'https://muchinochi55.com/【買う前に確認して！】マンション購入時の管理/', keywords: ['マンション', '管理費', '管理組合'] },
  { category: 'mansion', title: 'マンション大規模修繕の注意点', url: 'https://muchinochi55.com/【どれくらい知っていますか？】マンション大規/', keywords: ['大規模修繕', 'マンション', '修繕積立金'] },
];

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
    const articleListCompact = BLOG_ARTICLES.map(a => `${a.title}【${a.category}】`).join('、');

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

【会話ガイドライン】
- 温かく誠実に、「です・ます」調で。不安に寄り添い、専門用語はわかりやすく。
- 回答は適度な長さで箇条書きも活用。

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
- 「ほかにも気になるテーマがあれば、以下から選んでみてください」（選択肢の提示）
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

【深掘り質問ルール】
抽象的な質問（「〜について教えて」「何から始めれば」など）には、まず短く共感し選択肢を提示：
{{CHOICES|選択肢1|選択肢2|選択肢3|選択肢4}}
選択肢は3〜4個。具体的な質問や選択肢タップ後はそのまま回答。

【ブログ記事紹介】回答に関連する記事を最大2つ紹介可能。フォーマット：
{{ARTICLE|記事タイトル}}
利用可能な記事: ${articleListCompact}

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
      const article = BLOG_ARTICLES.find(a => a.title === title || title.includes(a.title) || a.title.includes(title));
      if (article) {
        return `{{ARTICLE|${article.title}|${article.url}}}`;
      }
      // Fuzzy match by keywords
      const fuzzy = BLOG_ARTICLES.find(a => a.keywords.some(k => title.includes(k)));
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
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'empty message' });

  const trimmedMsg = message.trim();
  if (!record.directChatHistory) record.directChatHistory = [];
  record.directChatHistory.push({
    role: 'agent',
    content: trimmedMsg,
    timestamp: new Date().toISOString()
  });
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

  const updatable = ['name','birthYear','birthMonth','age','prefecture','family','householdIncome','currentHome','reason','searchReason','area','budget','freeComment','propertyType','purpose','size','layout','stationDistance','occupation','income','savings','loanStatus','motivation','timeline','email','phone','line','referral','spouseOccupation','spouseIncome','currentRent','pet','parking','specialRequirements','memo','stage'];
  const updates = req.body;

  // Track old values for auto-tag update
  const oldPrefecture = record.prefecture;
  const oldPropertyType = record.propertyType;

  updatable.forEach(key => { if (updates[key] !== undefined) record[key] = updates[key]; });

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
});
