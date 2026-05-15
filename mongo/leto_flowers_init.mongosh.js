/**
 * Реальные скрипты MongoDB для проекта «flowers» (стиль mongosh).
 *
 * Запуск (из папки проекта или с полным путём к файлу):
 *   mongosh "mongodb://127.0.0.1:27017" mongo/leto_flowers_init.mongosh.js
 *
 * Или уже внутри mongosh (сначала cd в папку проекта):
 *   load("mongo/leto_flowers_init.mongosh.js")
 *
 * База по умолчанию совпадает с приложением: letoFlowersDB
 */

db = db.getSiblingDB('letoFlowersDB');

print('База: ' + db.getName());

// -----------------------------------------------------------------------------
// Индексы (как создаёт Mongoose по unique + как в mongodump metadata)
// -----------------------------------------------------------------------------

print('Создание индексов categories…');
db.categories.createIndex({ name: 1 }, { unique: true, background: true });

print('Создание индексов users…');
db.users.createIndex({ email: 1 }, { unique: true, background: true });

print('Создание индексов custombouquetorders…');
db.custombouquetorders.createIndex({ orderCode: 1 }, { unique: true, background: true });

// Дополнительно (удобно для каталога/сортировки; в дампе могло не быть)
print('Создание индексов products…');
db.products.createIndex({ category: 1, createdAt: -1 }, { background: true });

print('Создание индексов bouquetreservations…');
db.bouquetreservations.createIndex({ productId: 1, createdAt: -1 }, { background: true });
db.bouquetreservations.createIndex({ userId: 1, createdAt: -1 }, { background: true, sparse: true });

print('Статус «не готов» для старых бронирований без поля status…');
const legacyRes = db.bouquetreservations.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'not_ready' } }
);
print('  обновлено документов: ' + legacyRes.modifiedCount);

print('Индексы готовы.');

// Начальные категории (аналог ensureDefaultCategories() в server.js)

const defaultCategories = [
    {
        name: 'Монобукеты',
        image:
            'https://sun9-73.userapi.com/s/v1/ig2/hd3th0vQ7GqX9CPFydM9c20yb54aBYm5wXfZgfFiQMr_goBrz7zx7to__zrTuw0bnqfIuXdrLOP4hybesxY0Hrp2.jpg?quality=95&as=32x32,48x48,72x72,108x108,160x160,240x240,360x360,480x480,540x540,640x640,720x720,1000x1000&from=bu&cs=1000x0',
        sortOrder: 1
    },
    {
        name: 'Авторские букеты',
        image:
            'https://sun9-47.userapi.com/s/v1/ig2/kUD4lgFpa7lZbakYv2n0zT5hIu88lu9Vh6fASkzv47a4jO2OU2XLys1jL7pVNACSs5LC5d69M5jXqd7mxmicvVhE.jpg?quality=95&as=32x26,48x39,72x59,108x89,160x132,240x197,360x296,480x395,540x444,640x526,720x592,1000x822&from=bu&u=Tpp_69e20kdV7ZEF5go3WNCntgIN2UwMwaW5a_iDRuY&cs=1000x0',
        sortOrder: 2
    },
    {
        name: 'Цветы в коробке',
        image:
            'https://psv4.userapi.com/s/v1/d2/U6KEJehjlweJwLyLIwW3o2w_gRlJvrwlwDPxJd10P0wHwr7Kvg4S1sA_nEgnF3yXkW5nvHgn33YIGM6pcB7--hpMt507hOm29SqmvKpE8arPr3qpPIAmrbNCIqP8mkc259_PoXfcTJqT/Group_1_1.png',
        sortOrder: 3
    },
    {
        name: 'Цветы в корзине',
        image:
            'https://sun9-8.userapi.com/s/v1/ig2/IA0sGvl9fpGoqG27cNbvhsocpcBLeLyo9liEQkLaqWIsFju4QkgpFGldaHdTOgwrSM6gLKwTU81aXrXqmF3B6H8R.jpg?quality=95&as=32x32,48x48,72x72,108x108,160x160,240x240,360x360,480x480,540x540,640x640,720x720,1000x1000&from=bu&cs=1000x0',
        sortOrder: 4
    },
    {
        name: 'Цветы поштучно',
        image:
            'https://psv4.userapi.com/s/v1/d2/dxjBynuiBj0SGYatrDdVgWRcw0-aJlJpLKrL9nnsgb8AtzrrBmxnNd_tYqoa28fBpZAha3cLBZYA2mpFkzYYh0HZYexNvsrS_Qtx0y2-vtQrjVWNXq_zvbg8DYeNzWUhSxkj1oFVXyh5/Group_1_6.png',
        sortOrder: 5
    }
];

print('Upsert категорий (как в приложении)…');
defaultCategories.forEach((d) => {
    const r = db.categories.updateOne(
        { name: d.name },
        { $setOnInsert: { name: d.name, image: d.image, sortOrder: d.sortOrder } },
        { upsert: true }
    );
    if (r.upsertedCount) print('  вставлено: ' + d.name);
    else print('  уже было: ' + d.name);
});

print('Готово.');
