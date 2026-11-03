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
  needSignIn: 'To read room and booking data I need you signed in through the booking system (not demo mode). For now I can only tell you what I understood.',
  dbUnavailable: 'The room data is temporarily unavailable. Please try again in a moment.',
  pastDates: () => 'Those dates are in the past. Please give dates from today onwards.',
  needRefOrName: 'Please give a booking reference (for example R-K3F9QA) or a guest name.',
  notYet: (label) => `I cannot answer questions about ${label} yet.`,
  availYes: ({ type, from, to, nights, left, average, total }) => `Yes. ${type} is available from ${from} to ${to} (${nights} night${nights === 1 ? '' : 's'}): ${left} room${left === 1 ? '' : 's'} left, ${average} per night on average, ${total} in total.`,
  availNo: ({ type, from, to, reasons }) => `No. ${type} is not available from ${from} to ${to}: ${reasons}.`,
  availHeader: ({ from, to, nights, guests }) => `Room types from ${from} to ${to} (${nights} night${nights === 1 ? '' : 's'})${guests ? ` for ${guests} guest${guests === 1 ? '' : 's'}` : ''}:`,
  availLine: ({ name, left, average, total }) => `• ${name}: ${left} left · ${average} per night on average · ${total} in total`,
  availLineNo: ({ name, reasons }) => `• ${name}: not available (${reasons})`,
  availNone: 'There are no room types set up for sale.',
  reasons: { no_stock: () => 'no stock set for these dates', sold_out: () => 'sold out', max_guests: (n) => `sleeps at most ${n} guests`, min_nights: (n) => `minimum ${n} nights`, no_rate: () => 'no approved rate' },
  roomInfoHeader: 'Room types and how many guests they fit:',
  roomInfoLine: ({ name, guests, minNights }) => `• ${name}: up to ${guests} guests, minimum ${minNights} night${minNights === 1 ? '' : 's'}`,
  arrivalsHeader: (n) => `Arrivals today (${n}):`, arrivalsNone: 'No arrivals today.',
  departuresHeader: (n) => `Departures today (${n}):`, departuresNone: 'No departures today.',
  unpaidHeader: (n, shown) => `Unpaid bookings (${n})${n > shown ? `, showing the first ${shown}` : ''}:`, unpaidNone: 'There are no unpaid bookings.',
  roomWord: (no) => `room ${no}`,
  statuses: { CONFIRMED: 'Confirmed', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' },
  payments: { UNPAID: 'Unpaid', PARTIAL: 'Partly paid', PAID: 'Paid' },
  notFound: (what) => `I could not find a booking for ${what}.`,
  cancelOk: (ref) => `${ref} is confirmed, so staff can cancel it in the system. I cannot cancel it myself.`,
  cancelNo: (ref, status) => `${ref} is ${status.toLowerCase()}, so it cannot be cancelled. I cannot cancel bookings myself.`,
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
  needSignIn: 'Untuk membaca data bilik dan tempahan, anda perlu log masuk melalui sistem tempahan (bukan mod demo). Buat masa ini saya hanya boleh memberitahu apa yang saya faham.',
  dbUnavailable: 'Data bilik tidak tersedia buat sementara waktu. Sila cuba sebentar lagi.',
  pastDates: () => 'Tarikh tersebut sudah lepas. Sila berikan tarikh dari hari ini dan seterusnya.',
  needRefOrName: 'Sila berikan rujukan tempahan (contohnya R-K3F9QA) atau nama tetamu.',
  notYet: (label) => `Saya belum boleh menjawab soalan tentang ${label}.`,
  availYes: ({ type, from, to, nights, left, average, total }) => `Ya. ${type} tersedia dari ${from} hingga ${to} (${nights} malam): ${left} bilik berbaki, purata ${average} semalam, jumlah ${total}.`,
  availNo: ({ type, from, to, reasons }) => `Tidak. ${type} tidak tersedia dari ${from} hingga ${to}: ${reasons}.`,
  availHeader: ({ from, to, nights, guests }) => `Jenis bilik dari ${from} hingga ${to} (${nights} malam)${guests ? ` untuk ${guests} tetamu` : ''}:`,
  availLine: ({ name, left, average, total }) => `• ${name}: ${left} berbaki · purata ${average} semalam · jumlah ${total}`,
  availLineNo: ({ name, reasons }) => `• ${name}: tidak tersedia (${reasons})`,
  availNone: 'Tiada jenis bilik yang disediakan untuk dijual.',
  reasons: { no_stock: () => 'tiada stok ditetapkan untuk tarikh ini', sold_out: () => 'habis dijual', max_guests: (n) => `maksimum ${n} tetamu`, min_nights: (n) => `minimum ${n} malam`, no_rate: () => 'tiada kadar diluluskan' },
  roomInfoHeader: 'Jenis bilik dan bilangan tetamu yang muat:',
  roomInfoLine: ({ name, guests, minNights }) => `• ${name}: sehingga ${guests} tetamu, minimum ${minNights} malam`,
  arrivalsHeader: (n) => `Ketibaan hari ini (${n}):`, arrivalsNone: 'Tiada ketibaan hari ini.',
  departuresHeader: (n) => `Daftar keluar hari ini (${n}):`, departuresNone: 'Tiada daftar keluar hari ini.',
  unpaidHeader: (n, shown) => `Tempahan belum dibayar (${n})${n > shown ? `, menunjukkan ${shown} yang pertama` : ''}:`, unpaidNone: 'Tiada tempahan yang belum dibayar.',
  roomWord: (no) => `bilik ${no}`,
  statuses: { CONFIRMED: 'Disahkan', CHECKED_IN: 'Telah daftar masuk', CHECKED_OUT: 'Telah daftar keluar', CANCELLED: 'Dibatalkan' },
  payments: { UNPAID: 'Belum dibayar', PARTIAL: 'Dibayar sebahagian', PAID: 'Dibayar' },
  notFound: (what) => `Saya tidak menemui tempahan untuk ${what}.`,
  cancelOk: (ref) => `${ref} telah disahkan, jadi kakitangan boleh membatalkannya dalam sistem. Saya sendiri tidak boleh membatalkannya.`,
  cancelNo: (ref, status) => `${ref} berstatus "${status}", jadi tidak boleh dibatalkan. Saya sendiri tidak boleh membatalkan tempahan.`,
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
  needSignIn: '要读取房间和订单数据，需要通过订房系统登录（不是演示模式）。目前我只能告诉您我理解了什么。',
  dbUnavailable: '房间数据暂时无法使用，请稍后再试。',
  pastDates: () => '这些日期已经过去，请提供今天或之后的日期。',
  needRefOrName: '请提供订单编号（例如 R-K3F9QA）或客人姓名。',
  notYet: (label) => `我暂时还不能回答关于${label}的问题。`,
  availYes: ({ type, from, to, nights, left, average, total }) => `有空房。${type}在${from}至${to}（共${nights}晚）还剩${left}间，平均每晚${average}，总价${total}。`,
  availNo: ({ type, from, to, reasons }) => `没有空房。${type}在${from}至${to}无法预订：${reasons}。`,
  availHeader: ({ from, to, nights, guests }) => `${from}至${to}（共${nights}晚）${guests ? `、${guests}位客人` : ''}各房型情况：`,
  availLine: ({ name, left, average, total }) => `• ${name}：剩${left}间 · 平均每晚${average} · 总价${total}`,
  availLineNo: ({ name, reasons }) => `• ${name}：无法预订（${reasons}）`,
  availNone: '目前没有可销售的房型。',
  reasons: { no_stock: () => '这些日期未设置库存', sold_out: () => '已售罄', max_guests: (n) => `最多容纳${n}位客人`, min_nights: (n) => `最少入住${n}晚`, no_rate: () => '没有已批准的价格' },
  roomInfoHeader: '各房型可容纳的客人数：',
  roomInfoLine: ({ name, guests, minNights }) => `• ${name}：最多${guests}位客人，最少${minNights}晚`,
  arrivalsHeader: (n) => `今日抵店（${n}）：`, arrivalsNone: '今天没有抵店客人。',
  departuresHeader: (n) => `今日离店（${n}）：`, departuresNone: '今天没有离店客人。',
  unpaidHeader: (n, shown) => `未付款订单（${n}）${n > shown ? `，显示前${shown}条` : ''}：`, unpaidNone: '没有未付款的订单。',
  roomWord: (no) => `房间${no}`,
  statuses: { CONFIRMED: '已确认', CHECKED_IN: '已入住', CHECKED_OUT: '已退房', CANCELLED: '已取消' },
  payments: { UNPAID: '未付款', PARTIAL: '部分付款', PAID: '已付款' },
  notFound: (what) => `找不到与${what}相关的订单。`,
  cancelOk: (ref) => `${ref}已确认，工作人员可以在系统中取消。我自己不能取消订单。`,
  cancelNo: (ref, status) => `${ref}的状态是“${status}”，所以不能取消。我自己不能取消订单。`,
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
