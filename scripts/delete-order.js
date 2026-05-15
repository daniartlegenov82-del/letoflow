/**
 * Удаление индивидуального заказа по коду.
 * Запуск: node scripts/delete-order.js #164777
 * С облачной БД: set MONGODB_URI=ваша_строка && node scripts/delete-order.js #164777
 */
const mongoose = require('mongoose');

const orderCode = (process.argv[2] || process.env.ORDER_CODE || '').trim();

function resolveMongoUri() {
    let uri = (process.env.MONGODB_URI || '').trim();
    if (!uri) return 'mongodb://127.0.0.1:27017/letoFlowersDB';
    if ((uri.startsWith('"') && uri.endsWith('"')) || (uri.startsWith("'") && uri.endsWith("'"))) {
        uri = uri.slice(1, -1).trim();
    }
    if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
        console.error('Неверный MONGODB_URI. Строка должна начинаться с mongodb:// или mongodb+srv://');
        console.error('Пример Atlas:');
        console.error('  mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/letoFlowersDB');
        console.error('PowerShell:');
        console.error('  $env:MONGODB_URI = "mongodb+srv://USER:PASSWORD@cluster....mongodb.net/letoFlowersDB"');
        process.exit(1);
    }
    return uri;
}

const MONGODB_URI = resolveMongoUri();

if (!orderCode) {
    console.error('Укажите код заказа.');
    console.error('  PowerShell:  node scripts/delete-order.js "#164777"');
    console.error('  или:         node scripts/delete-order.js 164777');
    console.error('  или:         $env:ORDER_CODE="#164777"; node scripts/delete-order.js');
    process.exit(1);
}

const normalized = orderCode.startsWith('#') ? orderCode : `#${orderCode}`;

async function main() {
    await mongoose.connect(MONGODB_URI);
    const col = mongoose.connection.db.collection('custombouquetorders');
    const doc = await col.findOne({ orderCode: normalized });
    if (!doc) {
        console.log(`Заказ ${normalized} не найден в базе: ${MONGODB_URI.replace(/\/\/[^@]+@/, '//***@')}`);
        await mongoose.disconnect();
        process.exit(1);
    }
    const { deletedCount } = await col.deleteOne({ _id: doc._id });
    console.log(`Удалено: ${deletedCount}, код: ${doc.orderCode}, клиент: ${doc.fullName}`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
