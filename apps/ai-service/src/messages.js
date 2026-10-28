// All fixed wording, in English, Malay and Mandarin (Simplified). The model never writes these.
// NOTE: the Malay and Mandarin text was drafted by AI and has NOT been reviewed by a native reader yet.
// Database content (room type names, booking references, guest names) is never translated.
export const LANGS = ['en', 'ms', 'zh'];

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_MS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
export function fmtDate(lang, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (lang === 'zh') return `${y}年${m}月${d}日`;
  return `${d} ${(lang === 'ms' ? MONTHS_MS : MONTHS_EN)[m - 1]} ${y}`;
}

// Used only when no model decided the language (rules mode or a failed model call).
export function detectLang(text) {
  if (/[\u3400-\u9fff]/.test(text)) return 'zh';
  if (/\b(bilik|kosong|ada|tersedia|tempahan|untuk|dari|hingga|sampai|malam|tetamu|berapa|tolong|boleh|tidak|siapa|semak)\b/i.test(text)) return 'ms';
  return 'en';
}

export const UNSUPPORTED_NOTE = 'I can reply in English, Malay or Mandarin. / Saya boleh membalas dalam bahasa Inggeris, Melayu atau Mandarin. / 我可以用英语、马来语或中文回答。';

const en = {
  needDates: () => 'Which dates? Please give the check-in and check-out dates, for example “single room 25 to 30 Nov”.',
  availability: ({ type, from, to, nights, guests }) => `I understood this as an availability check for ${type || 'all room types'} from ${from} to ${to} (${nights} night${nights === 1 ? '' : 's'})${guests ? ` for ${guests} guest${guests === 1 ? '' : 's'}` : ''}.`,
  understood: (label) => `I understood this as a question about ${label}.`,
  pending: 'Room data is not connected to the assistant yet, so I cannot give availability, prices or booking details. This step only checks that I understand the question.',
  cannotBook: 'I cannot make bookings. Please do that on the booking screen.',
  refuseFinancial: 'I cannot change rates, discounts, refunds or payments. Please handle this in the system.',
  refuseCancel: 'I cannot cancel bookings. If you give me a booking reference, I can check its status.',
  refuseChange: 'I cannot delete, move or edit bookings, or mark them as paid. Please do this on the booking screen.',
  hold72: 'The 72-hour hold is not in this system yet, so I cannot answer that.',
  help: 'I can help with room availability and rates, booking lookups, arrivals and departures, and unpaid bookings. I cannot make or change bookings. Try: “single room 25 to 30 Nov”.',
  badRoomType: (names) => `I do not recognise that room type. Available types: ${names.join(', ')}.`,
  badDates: () => 'Those dates are not valid. Please use real dates, for example 25 to 30 Nov.',
  checkoutAfter: () => 'The check-out date must be after the check-in date.',
  longStay: () => 'I can only check up to 60 nights at a time.',
  labels: { room_info: 'room capacity', extend_check: 'extending a stay', cancel_check: 'whether a booking can be cancelled', unpaid: 'unpaid bookings', arrivals: 'today’s arrivals', departures: 'today’s departures', room_occupant: 'who is in a room', booking_lookup: 'a booking' },
};
const ms = {
  needDates: () => 'Tarikh mana? Sila nyatakan tarikh daftar masuk dan daftar keluar, contohnya “bilik single 25 hingga 30 Nov”.',
  availability: ({ type, from, to, nights, guests }) => `Saya faham ini sebagai semakan ketersediaan untuk ${type || 'semua jenis bilik'} dari ${from} hingga ${to} (${nights} malam)${guests ? ` untuk ${guests} tetamu` : ''}.`,
  understood: (label) => `Saya faham ini sebagai soalan tentang ${label}.`,
  pending: 'Data bilik belum disambungkan kepada pembantu, jadi saya belum boleh memberi maklumat ketersediaan, harga atau tempahan. Langkah ini hanya menyemak sama ada saya faham soalan.',
  cannotBook: 'Saya tidak boleh membuat tempahan. Sila lakukan di skrin tempahan.',
  refuseFinancial: 'Saya tidak boleh mengubah kadar, diskaun, bayaran balik atau bayaran. Sila uruskan di dalam sistem.',
  refuseCancel: 'Saya tidak boleh membatalkan tempahan. Berikan rujukan tempahan dan saya boleh menyemak statusnya.',
  refuseChange: 'Saya tidak boleh memadam, mengalih atau mengubah tempahan, atau menanda sebagai dibayar. Sila lakukan di skrin tempahan.',
  hold72: 'Penahanan 72 jam belum terdapat dalam sistem ini, jadi saya tidak dapat menjawabnya.',
  help: 'Saya boleh membantu dengan ketersediaan dan kadar bilik, carian tempahan, ketibaan dan daftar keluar, serta tempahan belum dibayar. Saya tidak boleh membuat atau mengubah tempahan. Cuba: “bilik single 25 hingga 30 Nov”.',
  badRoomType: (names) => `Jenis bilik tidak dikenali. Jenis yang ada: ${names.join(', ')}.`,
  badDates: () => 'Tarikh tidak sah. Gunakan tarikh sebenar, contohnya 25 hingga 30 Nov.',
  checkoutAfter: () => 'Tarikh daftar keluar mesti selepas tarikh daftar masuk.',
  longStay: () => 'Saya hanya boleh menyemak sehingga 60 malam sekali gus.',
  labels: { room_info: 'kapasiti bilik', extend_check: 'melanjutkan penginapan', cancel_check: 'sama ada tempahan boleh dibatalkan', unpaid: 'tempahan belum dibayar', arrivals: 'ketibaan hari ini', departures: 'daftar keluar hari ini', room_occupant: 'siapa berada dalam bilik', booking_lookup: 'satu tempahan' },
};
const zh = {
  needDates: () => '请问是哪几天？请提供入住和退房日期，例如“单人房 11月25日至30日”。',
  availability: ({ type, from, to, nights, guests }) => `我理解您想查询${type || '所有房型'}在${from}至${to}（共${nights}晚）${guests ? `、${guests}位客人` : ''}的空房情况。`,
  understood: (label) => `我理解这是关于${label}的问题。`,
  pending: '房间数据尚未连接到助手，所以我暂时无法提供空房、价格或订单信息。这一步只是确认我是否理解了问题。',
  cannotBook: '我不能创建订单，请在订单页面操作。',
  refuseFinancial: '我不能更改价格、折扣、退款或付款，请在系统中处理。',
  refuseCancel: '我不能取消订单。如果您提供订单编号，我可以查看其状态。',
  refuseChange: '我不能删除、调换或修改订单，也不能标记为已付款。请在订单页面操作。',
  hold72: '本系统目前还没有72小时保留功能，所以我无法回答这个问题。',
  help: '我可以协助查询房间空房和价格、订单查询、今日抵店和离店，以及未付款订单。我不能创建或修改订单。可以试试：“单人房 11月25日至30日”。',
  badRoomType: (names) => `无法识别该房型。可用房型：${names.join('、')}。`,
  badDates: () => '日期无效。请使用真实日期，例如11月25日至30日。',
  checkoutAfter: () => '退房日期必须晚于入住日期。',
  longStay: () => '我一次最多只能查询60晚。',
  labels: { room_info: '房型容量', extend_check: '延长住宿', cancel_check: '订单是否可以取消', unpaid: '未付款订单', arrivals: '今日抵店', departures: '今日离店', room_occupant: '房间入住人', booking_lookup: '订单查询' },
};
const ALL = { en, ms, zh };
export const messages = (lang) => ALL[lang] || en;
