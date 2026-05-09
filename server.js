//короткие пометки для навигации по файлу
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const SESSION_COOKIE_NAME = 'leto_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-session-secret';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/letoFlowersDB';
const IS_PROD = process.env.NODE_ENV === 'production';

let dbConnectPromise = null;
let defaultCategoriesReady = false;

function toBase64Url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(input) {
    if (!input || typeof input !== 'string') return null;
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
    return Buffer.from(padded, 'base64').toString('utf8');
}

function signSessionPayload(payload) {
    return toBase64Url(
        crypto
            .createHmac('sha256', SESSION_SECRET)
            .update(payload)
            .digest()
    );
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    const pairs = String(header).split(';');
    for (const p of pairs) {
        const i = p.indexOf('=');
        if (i < 0) continue;
        const key = p.slice(0, i).trim();
        const value = p.slice(i + 1).trim();
        out[key] = decodeURIComponent(value);
    }
    return out;
}

function parseSessionCookie(rawCookie) {
    if (!rawCookie || typeof rawCookie !== 'string') return {};
    const idx = rawCookie.lastIndexOf('.');
    if (idx <= 0) return {};
    const payload = rawCookie.slice(0, idx);
    const signature = rawCookie.slice(idx + 1);
    const expected = signSessionPayload(payload);
    const sigA = Buffer.from(signature);
    const sigB = Buffer.from(expected);
    if (sigA.length !== sigB.length) return {};
    if (!crypto.timingSafeEqual(sigA, sigB)) return {};
    try {
        const json = fromBase64Url(payload);
        const parsed = JSON.parse(json || '{}');
        if (!parsed || typeof parsed !== 'object') return {};
        if (parsed.exp && parsed.exp < Date.now()) return {};
        return parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    } catch (e) {
        return {};
    }
}

function serializeSessionCookie(sessionData) {
    const payload = JSON.stringify({
        exp: Date.now() + SESSION_TTL_MS,
        data: sessionData
    });
    const payloadEncoded = toBase64Url(payload);
    const signature = signSessionPayload(payloadEncoded);
    return `${payloadEncoded}.${signature}`;
}

function appendSetCookie(res, cookieValue) {
    const existing = res.getHeader('Set-Cookie');
    if (!existing) {
        res.setHeader('Set-Cookie', cookieValue);
        return;
    }
    if (Array.isArray(existing)) {
        res.setHeader('Set-Cookie', existing.concat(cookieValue));
        return;
    }
    res.setHeader('Set-Cookie', [existing, cookieValue]);
}

function setSessionCookie(res, sessionData) {
    const common = [
        `Path=/`,
        'HttpOnly',
        `SameSite=Lax`,
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    ];
    if (IS_PROD) common.push('Secure');
    const value = encodeURIComponent(serializeSessionCookie(sessionData));
    appendSetCookie(res, `${SESSION_COOKIE_NAME}=${value}; ${common.join('; ')}`);
}

function clearSessionCookie(res) {
    const common = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (IS_PROD) common.push('Secure');
    appendSetCookie(res, `${SESSION_COOKIE_NAME}=; ${common.join('; ')}`);
}

function isSessionEmpty(sessionData) {
    return !sessionData || Object.keys(sessionData).length === 0;
}

function clearSessionData(req) {
    if (!req.session || typeof req.session !== 'object') {
        req.session = {};
        return;
    }
    for (const key of Object.keys(req.session)) {
        delete req.session[key];
    }
}

async function ensureDatabaseReady() {
    if (mongoose.connection.readyState === 1) {
        if (!defaultCategoriesReady) {
            await ensureDefaultCategories();
            defaultCategoriesReady = true;
        }
        return;
    }
    if (!dbConnectPromise) {
        dbConnectPromise = mongoose
            .connect(MONGODB_URI)
            .then(async () => {
                if (!defaultCategoriesReady) {
                    await ensureDefaultCategories();
                    defaultCategoriesReady = true;
                }
            })
            .catch((err) => {
                dbConnectPromise = null;
                throw err;
            });
    }
    await dbConnectPromise;
}

const Product = mongoose.model('Product', {
    name: String,
    price: Number,
    image: String,
    category: String,
    inStock: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const Category = mongoose.model('Category', {
    name: { type: String, required: true, unique: true, trim: true },
    image: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 }
});

const DEFAULT_CATEGORY_TILE =
    'https://psv4.userapi.com/s/v1/d2/F9w0vJ7wLc_aPo9w_bSKlDueVRfddv0OnWqONpU1T0ayncnAD7DKb3OfAvbdLkjgczQ-pk7mn7bF9ElcmNy-F6ps3kqj_StPw26b5tYgQtQ0NKbCVmPpntLBLj_DAY1Es3IuCQ8rvZ04/Group_1_5.png';

const DEFAULT_CATEGORIES = [
    { name: 'Монобукеты', image: 'https://sun9-73.userapi.com/s/v1/ig2/hd3th0vQ7GqX9CPFydM9c20yb54aBYm5wXfZgfFiQMr_goBrz7zx7to__zrTuw0bnqfIuXdrLOP4hybesxY0Hrp2.jpg?quality=95&as=32x32,48x48,72x72,108x108,160x160,240x240,360x360,480x480,540x540,640x640,720x720,1000x1000&from=bu&cs=1000x0', sortOrder: 1 },
    { name: 'Авторские букеты', image: 'https://sun9-47.userapi.com/s/v1/ig2/kUD4lgFpa7lZbakYv2n0zT5hIu88lu9Vh6fASkzv47a4jO2OU2XLys1jL7pVNACSs5LC5d69M5jXqd7mxmicvVhE.jpg?quality=95&as=32x26,48x39,72x59,108x89,160x132,240x197,360x296,480x395,540x444,640x526,720x592,1000x822&from=bu&u=Tpp_69e20kdV7ZEF5go3WNCntgIN2UwMwaW5a_iDRuY&cs=1000x0', sortOrder: 2 },
    { name: 'Цветы в коробке', image: 'https://psv4.userapi.com/s/v1/d2/U6KEJehjlweJwLyLIwW3o2w_gRlJvrwlwDPxJd10P0wHwr7Kvg4S1sA_nEgnF3yXkW5nvHgn33YIGM6pcB7--hpMt507hOm29SqmvKpE8arPr3qpPIAmrbNCIqP8mkc259_PoXfcTJqT/Group_1_1.png', sortOrder: 3 },
    { name: 'Цветы в корзине', image: 'https://sun9-8.userapi.com/s/v1/ig2/IA0sGvl9fpGoqG27cNbvhsocpcBLeLyo9liEQkLaqWIsFju4QkgpFGldaHdTOgwrSM6gLKwTU81aXrXqmF3B6H8R.jpg?quality=95&as=32x32,48x48,72x72,108x108,160x160,240x240,360x360,480x480,540x540,640x640,720x720,1000x1000&from=bu&cs=1000x0', sortOrder: 4 },
    { name: 'Цветы поштучно', image: 'https://psv4.userapi.com/s/v1/d2/dxjBynuiBj0SGYatrDdVgWRcw0-aJlJpLKrL9nnsgb8AtzrrBmxnNd_tYqoa28fBpZAha3cLBZYA2mpFkzYYh0HZYexNvsrS_Qtx0y2-vtQrjVWNXq_zvbg8DYeNzWUhSxkj1oFVXyh5/Group_1_6.png', sortOrder: 5 }
];

async function ensureDefaultCategories() {
    for (const d of DEFAULT_CATEGORIES) {
        await Category.findOneAndUpdate(
            { name: d.name },
            { $setOnInsert: { name: d.name, image: d.image, sortOrder: d.sortOrder } },
            { upsert: true }
        );
    }
}

async function listCategories() {
    return Category.find().sort({ sortOrder: 1, name: 1 }).lean();
}

const DEFAULT_CATEGORY_NAMES = new Set(DEFAULT_CATEGORIES.map((d) => d.name));

const User = mongoose.model('User', {
    name: String,
    email: { type: String, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' },
    avatarUrl: { type: String, default: '' }
});

function isSafeHttpImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const t = url.trim();
    if (t.length > 2000) return false;
    const low = t.toLowerCase();
    return low.startsWith('https://') || low.startsWith('http://');
}

const Review = mongoose.model('Review', {
    name: String,
    rating: Number,
    comment: String,
    createdAt: { type: Date, default: Date.now }
});

const STEM_CATEGORY = 'Цветы поштучно';

const CUSTOM_ORDER_WRAP_OPTIONS = [
    { value: 'none', label: 'Без оформления', fee: 0 },
    { value: 'wrap', label: 'В обёртке', fee: 300 },
    { value: 'box', label: 'В коробке', fee: 550 },
    { value: 'basket', label: 'В корзине', fee: 650 },
    { value: 'large_basket', label: 'В большой корзине', fee: 1200 }
];

const CUSTOM_ORDER_GREENERY_FEE = 350;

function customOrderWrapFees() {
    return CUSTOM_ORDER_WRAP_OPTIONS.reduce((acc, o) => {
        acc[o.value] = o.fee;
        return acc;
    }, {});
}

function estimateCustomBouquet(stems, greenery, wrapping) {
    const fees = customOrderWrapFees();
    const wrapFee = fees[wrapping] ?? 0;
    const flowers = stems.reduce((sum, s) => sum + s.qty * s.unitPrice, 0);
    const g = greenery ? CUSTOM_ORDER_GREENERY_FEE : 0;
    return Math.round(flowers + g + wrapFee);
}

const ORDER_STATUS_VALUES = ['received', 'processing', 'ready', 'completed'];
const ORDER_STATUS_LABELS = {
    received: 'Принят',
    processing: 'В работе',
    ready: 'Готов к выдаче',
    completed: 'Выдан'
};

const CustomBouquetOrder = mongoose.model('CustomBouquetOrder', {
    orderCode: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
        type: String,
        enum: ORDER_STATUS_VALUES,
        default: 'received'
    },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    stems: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        name: String,
        qty: Number,
        unitPrice: Number
    }],
    greenery: { type: Boolean, default: false },
    wrapping: {
        type: String,
        enum: ['none', 'wrap', 'box', 'basket', 'large_basket'],
        required: true
    },
    comment: { type: String, default: '' },
    estimatedPrice: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});

const BouquetReservation = mongoose.model('BouquetReservation', {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    productName: { type: String, required: true },
    lastName: { type: String, required: true },
    firstName: { type: String, required: true },
    phone: { type: String, required: true },
    pickupAt: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

async function generateUniqueOrderCode() {
    for (let attempt = 0; attempt < 40; attempt++) {
        const n = String(Math.floor(100000 + Math.random() * 900000));
        const code = '#' + n;
        const exists = await CustomBouquetOrder.exists({ orderCode: code });
        if (!exists) return code;
    }
    return '#' + Date.now().toString().slice(-9);
}

function customOrderRenderPayload({ stemProducts, success, error, values, orderFlash }) {
    return {
        stemProducts,
        success: !!success,
        error: error || null,
        values: values || {},
        orderFlash: orderFlash || null,
        orderConfig: {
            greeneryFee: CUSTOM_ORDER_GREENERY_FEE,
            wrapOptions: CUSTOM_ORDER_WRAP_OPTIONS,
            wrapFees: customOrderWrapFees()
        }
    };
}

function stemQtyFromBody(stemProducts, body) {
    const stemQty = {};
    for (const p of stemProducts) {
        const raw = body[`qty_${p._id}`];
        const qty = Math.min(999, Math.max(0, parseInt(raw, 10) || 0));
        stemQty[String(p._id)] = qty;
    }
    return stemQty;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(async (req, res, next) => {
    try {
        await ensureDatabaseReady();
        next();
    } catch (err) {
        console.error('MongoDB connection error:', err);
        res.status(500).send('Ошибка подключения к базе данных');
    }
});
app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie || '');
    req.session = parseSessionCookie(cookies[SESSION_COOKIE_NAME]);

    const oldEnd = res.end;
    res.end = function patchedEnd(...args) {
        if (!res.headersSent) {
            if (isSessionEmpty(req.session)) clearSessionCookie(res);
            else setSessionCookie(res, req.session);
        }
        return oldEnd.apply(this, args);
    };
    next();
});

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.path = req.path;
    next();
});

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') next();
    else res.redirect('/login');
};

const requireCustomer = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'user') next();
    else res.redirect('/login');
};

app.get('/', async (req, res) => {
    try {
        const products = await Product.find().limit(4).sort({ createdAt: -1 });
        res.render('index', { products });
    } catch (e) { res.send(e); }
});

app.get('/catalog', async (req, res) => {
    try {
        const { category, minPrice, maxPrice } = req.query;
        let filter = {};

        if (category && category !== 'Все товары' && category !== 'Все цветы') {
            filter.category = category;
        }

        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = Number(minPrice);
            if (maxPrice) filter.price.$lte = Number(maxPrice);
        }

        const products = await Product.find(filter).sort({ createdAt: -1 });
        const categories = await listCategories();
        res.render('catalog', { products, query: req.query, categories });
    } catch (err) {
        res.status(500).send("Ошибка каталога");
    }
});

app.get('/about', (req, res) => res.render('about'));
app.get('/contacts', (req, res) => res.render('contacts'));

app.post('/bouquet-reservation/start', async (req, res) => {
    try {
        const productId = String(req.body.productId || '').trim();
        if (!mongoose.isValidObjectId(productId)) return res.redirect('/catalog');
        const product = await Product.findById(productId).select('_id inStock').lean();
        if (!product || product.inStock === false) return res.redirect('/catalog');
        req.session.reservationProductId = String(product._id);
        res.redirect('/bouquet-reservation');
    } catch (e) {
        res.redirect('/catalog');
    }
});

app.get('/bouquet-reservation', async (req, res) => {
    try {
        if (req.query.success === '1' && req.session.reservationSuccess) {
            const reservation = req.session.reservationSuccess;
            delete req.session.reservationSuccess;
            return res.render('bouquet-reservation', {
                product: null,
                values: {},
                error: null,
                success: true,
                reservation
            });
        }
        const reservationProductId = req.session.reservationProductId;
        if (!reservationProductId || !mongoose.isValidObjectId(reservationProductId)) {
            return res.redirect('/catalog');
        }
        const product = await Product.findById(reservationProductId).lean();
        if (!product || product.inStock === false) {
            delete req.session.reservationProductId;
            return res.redirect('/catalog');
        }
        res.render('bouquet-reservation', {
            product,
            values: {},
            error: req.query.error || null,
            success: false,
            reservation: null
        });
    } catch (e) {
        res.redirect('/catalog');
    }
});

app.post('/bouquet-reservation', async (req, res) => {
    try {
        const reservationProductId = req.session.reservationProductId;
        if (!reservationProductId || !mongoose.isValidObjectId(reservationProductId)) {
            return res.redirect('/catalog');
        }
        const product = await Product.findById(reservationProductId).lean();
        if (!product || product.inStock === false) {
            delete req.session.reservationProductId;
            return res.redirect('/catalog');
        }

        const lastName = (req.body.lastName || '').trim();
        const firstName = (req.body.firstName || '').trim();
        const phone = (req.body.phone || '').trim();
        const pickupDate = (req.body.pickupDate || '').trim();
        const pickupTime = (req.body.pickupTime || '').trim();
        const pickupAt = `${pickupDate} ${pickupTime}`.trim();

        if (!lastName || !firstName || !phone || !pickupDate || !pickupTime) {
            return res.status(400).render('bouquet-reservation', {
                product,
                values: { lastName, firstName, phone, pickupDate, pickupTime },
                error: 'validation',
                success: false
            });
        }

        let userId = null;
        if (req.session.user && req.session.user.role === 'user' && req.session.user._id) {
            userId = new mongoose.Types.ObjectId(req.session.user._id);
        }

        await BouquetReservation.create({
            productId: product._id,
            userId,
            productName: product.name,
            lastName,
            firstName,
            phone,
            pickupAt
        });
        req.session.reservationSuccess = {
            productName: product.name,
            pickupAt
        };
        delete req.session.reservationProductId;
        return res.redirect('/bouquet-reservation?success=1');
    } catch (e) {
        return res.redirect('/catalog');
    }
});

app.get('/custom-order', async (req, res) => {
    try {
        const stemProducts = await Product.find({ category: STEM_CATEGORY }).sort({ createdAt: -1 }).lean();
        let orderFlash = null;
        if (req.query.confirmed === '1' && req.session.orderFlash) {
            orderFlash = req.session.orderFlash;
            delete req.session.orderFlash;
        }
        const pageError = req.query.error || null;
        res.render('custom-order', customOrderRenderPayload({
            stemProducts,
            success: false,
            error: pageError,
            values: {},
            orderFlash
        }));
    } catch (e) {
        res.status(500).send('Ошибка загрузки страницы заказа');
    }
});

app.post('/custom-order', async (req, res) => {
    const wantsJson = (req.get('Accept') || '').includes('application/json');
    try {
        const stemProducts = await Product.find({ category: STEM_CATEGORY }).sort({ createdAt: -1 }).lean();
        const availableStemProducts = stemProducts.filter((p) => p.inStock !== false);
        const fullName = (req.body.fullName || '').trim();
        const phone = (req.body.phone || '').trim();
        const email = (req.body.email || '').trim();
        const comment = (req.body.comment || '').trim();
        const wrapAllowed = new Set(CUSTOM_ORDER_WRAP_OPTIONS.map((o) => o.value));
        const wrapping = wrapAllowed.has(req.body.wrapping) ? req.body.wrapping : 'none';
        const greenery = req.body.greenery === '1';
        const stemQty = stemQtyFromBody(availableStemProducts, req.body);

        const baseValues = {
            fullName,
            phone,
            email,
            comment,
            wrapping,
            greenery,
            stemQty
        };

        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!fullName || !phone || !email || !emailOk) {
            if (wantsJson) return res.status(400).json({ ok: false, error: 'validation' });
            return res.status(400).render(
                'custom-order',
                customOrderRenderPayload({ stemProducts, success: false, error: 'validation', values: baseValues })
            );
        }

        const stems = [];
        for (const p of availableStemProducts) {
            const qty = stemQty[String(p._id)] || 0;
            if (qty > 0) {
                stems.push({
                    productId: p._id,
                    name: p.name,
                    qty,
                    unitPrice: Number(p.price) || 0
                });
            }
        }

        if (stemProducts.length > 0 && stems.length === 0) {
            if (wantsJson) return res.status(400).json({ ok: false, error: 'no_flowers' });
            return res.status(400).render(
                'custom-order',
                customOrderRenderPayload({ stemProducts, success: false, error: 'no_flowers', values: baseValues })
            );
        }

        const estimatedPrice = estimateCustomBouquet(stems, greenery, wrapping);
        const orderCode = await generateUniqueOrderCode();
        let userId = null;
        if (req.session.user && req.session.user.role === 'user' && req.session.user._id) {
            userId = new mongoose.Types.ObjectId(req.session.user._id);
        }

        await CustomBouquetOrder.create({
            orderCode,
            userId,
            fullName,
            phone,
            email,
            stems,
            greenery,
            wrapping,
            comment,
            estimatedPrice,
            status: 'received'
        });

        if (wantsJson) {
            return res.json({
                ok: true,
                orderCode,
                estimatedPrice,
                priceText: estimatedPrice.toLocaleString('ru-RU') + ' ₽'
            });
        }
        req.session.orderFlash = {
            orderCode,
            estimatedPrice,
            priceText: estimatedPrice.toLocaleString('ru-RU') + ' ₽'
        };
        return res.redirect('/custom-order?confirmed=1');
    } catch (e) {
        if (wantsJson) return res.status(500).json({ ok: false, error: 'server' });
        return res.redirect('/custom-order?error=server');
    }
});

app.get('/account', requireCustomer, async (req, res) => {
    try {
        const uid = new mongoose.Types.ObjectId(req.session.user._id);
        const [profile, orders, reservations] = await Promise.all([
            User.findById(uid).select('name email avatarUrl').lean(),
            CustomBouquetOrder.find({ userId: uid }).sort({ createdAt: -1 }).lean(),
            BouquetReservation.find({ userId: uid }).sort({ createdAt: -1 }).lean()
        ]);
        if (!profile) return res.redirect('/logout');
        res.render('account', {
            profile,
            orders,
            reservations,
            orderStatusLabels: ORDER_STATUS_LABELS,
            profileMsg: req.query.msg || null,
            profileErr: req.query.err || null
        });
    } catch (e) {
        res.status(500).send('Не удалось загрузить кабинет');
    }
});

app.post('/account/profile', requireCustomer, async (req, res) => {
    try {
        const raw = (req.body.avatarUrl || '').trim();
        const uid = req.session.user._id;
        if (raw && !isSafeHttpImageUrl(raw)) {
            return res.redirect('/account?err=invalid_url');
        }
        const avatarUrl = raw || '';
        await User.findByIdAndUpdate(uid, { $set: { avatarUrl } });
        req.session.user = Object.assign({}, req.session.user, { avatarUrl });
        res.redirect('/account?msg=saved');
    } catch (e) {
        res.redirect('/account?err=save');
    }
});

app.get('/admin/orders', isAdmin, async (req, res) => {
    try {
        const [orders, reservations] = await Promise.all([
            CustomBouquetOrder.find().sort({ createdAt: -1 }).lean(),
            BouquetReservation.find().sort({ createdAt: -1 }).lean()
        ]);
        res.render('admin-orders', { orders, reservations, orderStatusLabels: ORDER_STATUS_LABELS, orderStatuses: ORDER_STATUS_VALUES });
    } catch (e) {
        res.status(500).send('Ошибка загрузки заказов');
    }
});

app.post('/admin/orders/:id/status', isAdmin, async (req, res) => {
    try {
        const status = (req.body.status || '').trim();
        if (!ORDER_STATUS_VALUES.includes(status)) return res.redirect('/admin/orders');
        await CustomBouquetOrder.findByIdAndUpdate(req.params.id, { status });
        res.redirect('/admin/orders');
    } catch (e) {
        res.redirect('/admin/orders');
    }
});

app.get('/reviews', async (req, res) => {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.render('reviews', { reviews });
});

app.post('/reviews', async (req, res) => {
    try {
        const { name, rating, comment } = req.body;
        await Review.create({ name, rating: Number(rating), comment });
        res.redirect('/reviews');
    } catch (e) { res.send(e); }
});

app.get('/reviews/delete/:id', isAdmin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/reviews');
        await Review.findByIdAndDelete(req.params.id);
        res.redirect('/reviews');
    } catch (e) {
        res.redirect('/reviews');
    }
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    if (password !== confirmPassword) return res.render('register', { error: 'Пароли не совпадают' });

    try {
        const existing = await User.findOne({ email });
        if (existing) return res.render('register', { error: 'Email уже занят' });

        const hashed = await bcrypt.hash(password, 10);
        await User.create({ name, email, password: hashed });
        res.redirect('/login');
    } catch (e) { res.send(e); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            avatarUrl: user.avatarUrl || ''
        };
        res.redirect(user.role === 'admin' ? '/admin' : '/');
    } else {
        res.render('login', { error: 'Неверные данные' });
    }
});

app.get('/logout', (req, res) => {
    clearSessionData(req);
    res.redirect('/');
});

app.get('/admin', isAdmin, async (req, res) => {
    const products = await Product.find().sort({ createdAt: -1 });
    const categories = await listCategories();
    const editProduct = req.query.edit ? await Product.findById(req.query.edit) : null;
    const catMsg = req.query.catMsg || null;
    const catErr = req.query.catErr || null;
    const defaultCategoryNames = DEFAULT_CATEGORIES.map((d) => d.name);
    res.render('admin', { products, editProduct, categories, catMsg, catErr, defaultCategoryNames });
});

app.post('/admin/category', isAdmin, async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.redirect('/admin?catErr=empty');
    try {
        const last = await Category.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
        const sortOrder = (last && typeof last.sortOrder === 'number') ? last.sortOrder + 1 : 100;
        await Category.create({
            name,
            image: DEFAULT_CATEGORY_TILE,
            sortOrder
        });
        res.redirect('/admin?catMsg=created');
    } catch (e) {
        if (e && e.code === 11000) return res.redirect('/admin?catErr=duplicate');
        res.redirect('/admin?catErr=fail');
    }
});

app.get('/admin/category/delete/:id', isAdmin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.redirect('/admin?catErr=nocat');
        }
        const cat = await Category.findById(req.params.id);
        if (!cat) return res.redirect('/admin?catErr=nocat');
        if (DEFAULT_CATEGORY_NAMES.has(cat.name)) {
            return res.redirect('/admin?catErr=protected');
        }
        const inUse = await Product.countDocuments({ category: cat.name });
        if (inUse > 0) return res.redirect('/admin?catErr=inUse');
        await Category.findByIdAndDelete(req.params.id);
        res.redirect('/admin?catMsg=deleted');
    } catch (e) {
        res.redirect('/admin?catErr=fail');
    }
});

app.post('/admin/add', isAdmin, async (req, res) => {
    await Product.create(req.body);
    res.redirect('/admin');
});

app.post('/admin/edit/:id', isAdmin, async (req, res) => {
    await Product.findByIdAndUpdate(req.params.id, req.body);
    res.redirect('/admin');
});

app.post('/admin/stock/:id', isAdmin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/admin');
        const raw = String(req.body.inStock || '').trim();
        if (raw !== 'true' && raw !== 'false') return res.redirect('/admin');
        await Product.findByIdAndUpdate(req.params.id, { inStock: raw === 'true' });
        res.redirect('/admin');
    } catch (e) {
        res.redirect('/admin');
    }
});

app.get('/admin/delete/:id', isAdmin, async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
});

if (require.main === module) {
    ensureDatabaseReady()
        .then(() => {
            const port = Number(process.env.PORT) || 3000;
            app.listen(port, () => {
                console.log(`LetoFlowers работает на http://localhost:${port}`);
            });
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = app;