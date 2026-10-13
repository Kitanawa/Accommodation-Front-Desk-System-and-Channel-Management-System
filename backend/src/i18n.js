// Reply templates for English (en), Malay (ms) and Mandarin / Simplified Chinese (zh).
// Replies are still built by code from database results: the model never writes reply text.
// Database content (room type names, booking IDs, guest names, agent names) is inserted as stored, never translated.
// The English templates are word-for-word what chat.js used before, so English behaviour is unchanged.
// NOTE: the ms and zh wording was drafted by an AI and should be read once by a person who knows the language.

export const LANGS = ['en', 'ms', 'zh'];

const CJK = /[\u3400-\u9fff]/;
// Words that are clearly Malay and not English. Only used when the model did not give a language (rules mode or a failed call).
const MS_WORDS = /\b(bilik|tempahan|tersedia|tiada|berapa|tarikh|malam|hingga|sampai|untuk|boleh|tolong|sila|belum|dibayar|batal|tetamu|kosong|harga|lanjut|siapa|daftar|saya|nak)\b/i;

export function detectLang(text) {
  const t = String(text || '');
  if (CJK.test(t)) return 'zh';
  if (MS_WORDS.test(t)) return 'ms';
  return 'en';
}

const MS_MON = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
export function fmtDate(lang, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m || lang === 'en') return iso;
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
  return lang === 'ms' ? `${d} ${MS_MON[mo - 1]} ${y}` : `${y}年${mo}月${d}日`;
}

const rm = (n) => `RM${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Status words come from the database as codes. Unknown codes are shown as stored.
const STATUS = {
  ms: { confirmed: 'disahkan', cancelled: 'dibatalkan', checked_in: 'telah daftar masuk', checked_out: 'telah daftar keluar' },
  zh: { confirmed: '已确认', cancelled: '已取消', checked_in: '已入住', checked_out: '已退房' },
};
const PAY = { ms: { unpaid: 'belum dibayar', paid: 'dibayar' }, zh: { unpaid: '未付款', paid: '已付款' } };
const ROOMSTATUS = {
  ms: { available: 'tersedia', occupied: 'diduduki', cleaning: 'pembersihan', maintenance: 'penyelenggaraan' },
  zh: { available: '可用', occupied: '已占用', cleaning: '清洁中', maintenance: '维修中' },
};
const word = (table, lang, v) => (table[lang] && table[lang][v]) || v;

const en = {
  nights: (n) => plural(n, 'night'),
  rooms: (n) => plural(n, 'room'),
  status: (v) => v, pay: (v) => v, roomStatus: (v) => v,
  na: () => 'n/a',
  amountNa: () => 'amount n/a',
  badRoomType: (names) => 'I do not have that room type. Room types: ' + names.join(', ') + '.',
  badDates: () => 'I could not read those dates. Please use a format like "25 Nov to 30 Nov".',
  checkoutAfter: () => 'The check-out date must be after the check-in date.',
  longStay: () => 'That is a long stay (over 60 nights). Please give a shorter range.',
  askDates: () => 'Which dates? For example: "single room 25 Nov to 30 Nov".',
  header: (v) => `Availability ${v.from} to ${v.to} (${en.nights(v.nights)})${v.type ? ' for ' + v.type : ''}${v.guests ? ' for ' + v.guests + ' guests' : ''}${v.maxPrice ? ` at ${v.below ? 'below' : 'up to'} ${rm(v.maxPrice)}/night` : ''}:`,
  noMatch: () => 'No room type matches those conditions.',
  yes: (v) => `Yes, ${v.type} is available from ${v.from} to ${v.to} (${en.nights(v.nights)}).\n- ${v.type}: ${en.rooms(v.left)} left, ${rm(v.rate)}/night, ${rm(v.total)} total`,
  no: (v) => `No, ${v.type} is fully booked on at least one night from ${v.from} to ${v.to} (${en.nights(v.nights)}).\n- ${v.type}: fully booked on at least one night`,
  lineFree: (v) => `- ${v.type}: ${en.rooms(v.left)} left, ${rm(v.rate)}/night, ${rm(v.total)} total`,
  lineFull: (v) => `- ${v.type}: fully booked on at least one night`,
  nothingFree: () => 'Nothing is available for the whole stay. Try other dates.',
  highlight: () => 'I have highlighted those dates on the room planner.',
  cannotBook: () => 'I cannot create bookings. Please press Book on the dashboard for the room you choose.',
  noBooking: (ref) => `I cannot find booking ${ref}.`,
  extCancelled: (ref) => `${ref} is cancelled, so it cannot be extended.`,
  extAsk: (v) => `${v.ref} (${v.type}) currently ends on ${v.out}. Until which date should it be extended?`,
  extYes: (v) => `${v.ref} (${v.type}, ${v.in} to ${v.out}) can be extended to ${v.target}: ${en.rooms(v.left)} left for the extra ${en.nights(v.nights)}, ${rm(v.total)} extra. I cannot change the booking. Use Edit Room on the dashboard.`,
  extNo: (v) => `${v.ref} cannot be extended to ${v.target}: ${v.type} is fully booked on at least one of those nights.`,
  cancelAlready: (ref) => `${ref} is already cancelled.`,
  cancelFree: (v) => `${v.ref} is blocked and still free to cancel: ${v.hours} hours before check-in (more than 72). I cannot cancel it. Use Cancel on the dashboard.`,
  cancelWithin: (v) => `${v.ref} is within 72 hours of check-in (${v.hours} hours), so it should now be a confirmed booking and cannot be cancelled in the system. Exceptions are handled by phone.`,
  cancelOther: (v) => `${v.ref} is ${v.status}. Cancellation in the system is only for blocked bookings more than 72 hours before check-in.`,
  w72Title: () => 'Blocked bookings within 72 hours of check-in (should be confirmed and invoiced by the system):',
  w72Line: (v) => `- ${v.ref}: ${v.agent}, ${v.type}, check-in ${v.in} (${v.hours} hours)`,
  w72None: () => 'No blocked bookings are within 72 hours of check-in.',
  canTitle: () => 'Blocked bookings still free to cancel (more than 72 hours before check-in):',
  canLine: (v) => `- ${v.ref}: ${v.agent}, ${v.type}, check-in ${v.in} (${v.hours} hours left)`,
  canNone: () => 'No blocked bookings are still free to cancel.',
  unpaidTitle: () => 'Unpaid bookings (confirmed or in-house):',
  unpaidLine: (v) => `- ${v.ref}: ${v.by}, ${v.in} to ${v.out}, ${v.amount}`,
  unpaidNone: () => 'There are no unpaid confirmed bookings.',
  arrTitle: (d) => `Arrivals today (${d}):`,
  depTitle: (d) => `Departures today (${d}):`,
  arrNone: (d) => `No arrivals today (${d}).`,
  depNone: (d) => `No departures today (${d}).`,
  dayLine: (v) => `- ${v.ref}: ${v.by}, ${v.type} (${v.status})`,
  roomNone: (n) => `I cannot find room ${n}.`,
  roomIn: (v) => `Room ${v.n} is occupied by ${v.name} (${v.ref}, ${v.in} to ${v.out}).`,
  roomEmpty: (v) => `Room ${v.n} has no checked-in guest (room status: ${v.status}).`,
  findTitle: () => 'Bookings found:',
  findLine: (v) => `- ${v.ref}: ${v.who}, ${v.type}${v.room ? ' room ' + v.room : ''}, ${v.in} to ${v.out}, ${v.status}, ${v.pay}`,
  findNone: (x) => `I could not find any booking for ${x}.`,
  refuseFinancial: () => 'I cannot give refunds, discounts, vouchers or change rates. Those decisions are made by staff with the right access. I can show rates and availability if that helps.',
  refuseCancel: () => 'I cannot cancel bookings. Open the booking on the dashboard and use Cancel. If you give me the booking ID, I can check whether it is still free to cancel.',
  help: () => 'I can help with room availability and rates for given dates, bookings by guest or booking ID, unpaid bookings, bookings near the 72-hour deadline, and today\'s arrivals or departures. Try: "single room 25th to 30th November".',
};

const ms = {
  nights: (n) => `${n} malam`,
  rooms: (n) => `${n} bilik`,
  status: (v) => word(STATUS, 'ms', v), pay: (v) => word(PAY, 'ms', v), roomStatus: (v) => word(ROOMSTATUS, 'ms', v),
  na: () => 'tiada',
  amountNa: () => 'jumlah tiada',
  badRoomType: (names) => 'Saya tiada jenis bilik itu. Jenis bilik: ' + names.join(', ') + '.',
  badDates: () => 'Saya tidak dapat membaca tarikh tersebut. Sila gunakan format seperti "25 Nov hingga 30 Nov".',
  checkoutAfter: () => 'Tarikh daftar keluar mesti selepas tarikh daftar masuk.',
  longStay: () => 'Itu penginapan yang panjang (melebihi 60 malam). Sila berikan julat yang lebih pendek.',
  askDates: () => 'Tarikh mana? Contohnya: "bilik single 25 Nov hingga 30 Nov".',
  header: (v) => `Ketersediaan ${v.from} hingga ${v.to} (${ms.nights(v.nights)})${v.type ? ' untuk ' + v.type : ''}${v.guests ? ' untuk ' + v.guests + ' tetamu' : ''}${v.maxPrice ? ` pada harga ${v.below ? 'bawah' : 'sehingga'} ${rm(v.maxPrice)}/malam` : ''}:`,
  noMatch: () => 'Tiada jenis bilik yang memenuhi syarat tersebut.',
  yes: (v) => `Ya, ${v.type} tersedia dari ${v.from} hingga ${v.to} (${ms.nights(v.nights)}).\n- ${v.type}: ${ms.rooms(v.left)} lagi, ${rm(v.rate)}/malam, jumlah ${rm(v.total)}`,
  no: (v) => `Tidak, ${v.type} telah penuh ditempah pada sekurang-kurangnya satu malam dari ${v.from} hingga ${v.to} (${ms.nights(v.nights)}).\n- ${v.type}: penuh ditempah pada sekurang-kurangnya satu malam`,
  lineFree: (v) => `- ${v.type}: ${ms.rooms(v.left)} lagi, ${rm(v.rate)}/malam, jumlah ${rm(v.total)}`,
  lineFull: (v) => `- ${v.type}: penuh ditempah pada sekurang-kurangnya satu malam`,
  nothingFree: () => 'Tiada bilik tersedia untuk seluruh tempoh penginapan. Cuba tarikh lain.',
  highlight: () => 'Saya telah menyerlahkan tarikh tersebut pada perancang bilik.',
  cannotBook: () => 'Saya tidak boleh membuat tempahan. Sila tekan Book pada papan pemuka untuk bilik yang dipilih.',
  noBooking: (ref) => `Saya tidak jumpa tempahan ${ref}.`,
  extCancelled: (ref) => `${ref} telah dibatalkan, jadi tidak boleh dilanjutkan.`,
  extAsk: (v) => `${v.ref} (${v.type}) kini tamat pada ${v.out}. Dilanjutkan sehingga tarikh mana?`,
  extYes: (v) => `${v.ref} (${v.type}, ${v.in} hingga ${v.out}) boleh dilanjutkan sehingga ${v.target}: ${ms.rooms(v.left)} lagi untuk ${ms.nights(v.nights)} tambahan, ${rm(v.total)} tambahan. Saya tidak boleh mengubah tempahan. Gunakan Edit Room pada papan pemuka.`,
  extNo: (v) => `${v.ref} tidak boleh dilanjutkan sehingga ${v.target}: ${v.type} telah penuh ditempah pada sekurang-kurangnya satu daripada malam tersebut.`,
  cancelAlready: (ref) => `${ref} telah pun dibatalkan.`,
  cancelFree: (v) => `${v.ref} berstatus blocked dan masih boleh dibatalkan: ${v.hours} jam sebelum daftar masuk (lebih daripada 72). Saya tidak boleh membatalkannya. Gunakan Cancel pada papan pemuka.`,
  cancelWithin: (v) => `${v.ref} berada dalam tempoh 72 jam sebelum daftar masuk (${v.hours} jam), jadi ia sepatutnya sudah menjadi tempahan yang disahkan dan tidak boleh dibatalkan dalam sistem. Pengecualian dikendalikan melalui telefon.`,
  cancelOther: (v) => `${v.ref} berstatus ${v.status}. Pembatalan dalam sistem hanya untuk tempahan blocked lebih daripada 72 jam sebelum daftar masuk.`,
  w72Title: () => 'Tempahan blocked dalam tempoh 72 jam sebelum daftar masuk (sepatutnya disahkan dan diinvois oleh sistem):',
  w72Line: (v) => `- ${v.ref}: ${v.agent}, ${v.type}, daftar masuk ${v.in} (${v.hours} jam)`,
  w72None: () => 'Tiada tempahan blocked dalam tempoh 72 jam sebelum daftar masuk.',
  canTitle: () => 'Tempahan blocked yang masih boleh dibatalkan (lebih daripada 72 jam sebelum daftar masuk):',
  canLine: (v) => `- ${v.ref}: ${v.agent}, ${v.type}, daftar masuk ${v.in} (${v.hours} jam lagi)`,
  canNone: () => 'Tiada tempahan blocked yang masih boleh dibatalkan.',
  unpaidTitle: () => 'Tempahan belum dibayar (disahkan atau sedang menginap):',
  unpaidLine: (v) => `- ${v.ref}: ${v.by}, ${v.in} hingga ${v.out}, ${v.amount}`,
  unpaidNone: () => 'Tiada tempahan disahkan yang belum dibayar.',
  arrTitle: (d) => `Ketibaan hari ini (${d}):`,
  depTitle: (d) => `Daftar keluar hari ini (${d}):`,
  arrNone: (d) => `Tiada ketibaan hari ini (${d}).`,
  depNone: (d) => `Tiada daftar keluar hari ini (${d}).`,
  dayLine: (v) => `- ${v.ref}: ${v.by}, ${v.type} (${v.status})`,
  roomNone: (n) => `Saya tidak jumpa bilik ${n}.`,
  roomIn: (v) => `Bilik ${v.n} diduduki oleh ${v.name} (${v.ref}, ${v.in} hingga ${v.out}).`,
  roomEmpty: (v) => `Bilik ${v.n} tiada tetamu yang telah daftar masuk (status bilik: ${v.status}).`,
  findTitle: () => 'Tempahan ditemui:',
  findLine: (v) => `- ${v.ref}: ${v.who}, ${v.type}${v.room ? ' bilik ' + v.room : ''}, ${v.in} hingga ${v.out}, ${v.status}, ${v.pay}`,
  findNone: (x) => `Saya tidak jumpa sebarang tempahan untuk ${x}.`,
  refuseFinancial: () => 'Saya tidak boleh memberi bayaran balik, diskaun, baucar atau mengubah kadar. Keputusan itu dibuat oleh kakitangan yang mempunyai akses yang sesuai. Saya boleh menunjukkan kadar dan ketersediaan jika itu membantu.',
  refuseCancel: () => 'Saya tidak boleh membatalkan tempahan. Buka tempahan pada papan pemuka dan gunakan Cancel. Jika anda beri ID tempahan, saya boleh semak sama ada ia masih boleh dibatalkan.',
  help: () => 'Saya boleh membantu dengan ketersediaan dan kadar bilik untuk tarikh tertentu, tempahan mengikut tetamu atau ID tempahan, tempahan belum dibayar, tempahan yang menghampiri tarikh akhir 72 jam, serta ketibaan atau daftar keluar hari ini. Cuba: "bilik single 25 hingga 30 November".',
};

const zh = {
  nights: (n) => `${n}晚`,
  rooms: (n) => `${n}间`,
  status: (v) => word(STATUS, 'zh', v), pay: (v) => word(PAY, 'zh', v), roomStatus: (v) => word(ROOMSTATUS, 'zh', v),
  na: () => '无',
  amountNa: () => '金额不详',
  badRoomType: (names) => '没有这个房型。可选房型：' + names.join('、') + '。',
  badDates: () => '我无法识别这些日期。请使用类似“11月25日至11月30日”的格式。',
  checkoutAfter: () => '退房日期必须晚于入住日期。',
  longStay: () => '入住时间过长（超过60晚）。请缩短日期范围。',
  askDates: () => '请问是哪几天？例如：“单人房 11月25日至11月30日”。',
  header: (v) => `空房情况 ${v.from} 至 ${v.to}（${zh.nights(v.nights)}）${v.type ? '，房型：' + v.type : ''}${v.guests ? '，' + v.guests + '位客人' : ''}${v.maxPrice ? `，每晚${v.below ? '低于' : '不超过'} ${rm(v.maxPrice)}` : ''}：`,
  noMatch: () => '没有符合这些条件的房型。',
  yes: (v) => `是的，${v.type} 在 ${v.from} 至 ${v.to}（${zh.nights(v.nights)}）有空房。\n- ${v.type}：剩余${zh.rooms(v.left)}，每晚 ${rm(v.rate)}，共 ${rm(v.total)}`,
  no: (v) => `没有，${v.type} 在 ${v.from} 至 ${v.to}（${zh.nights(v.nights)}）期间至少有一晚已订满。\n- ${v.type}：至少有一晚已订满`,
  lineFree: (v) => `- ${v.type}：剩余${zh.rooms(v.left)}，每晚 ${rm(v.rate)}，共 ${rm(v.total)}`,
  lineFull: (v) => `- ${v.type}：至少有一晚已订满`,
  nothingFree: () => '整个入住期间没有可订的房间。请尝试其他日期。',
  highlight: () => '我已在房态表上标出这些日期。',
  cannotBook: () => '我无法创建预订。请在面板上为所选房间点击 Book。',
  noBooking: (ref) => `找不到预订 ${ref}。`,
  extCancelled: (ref) => `${ref} 已取消，因此无法延长。`,
  extAsk: (v) => `${v.ref}（${v.type}）目前于 ${v.out} 结束。要延长到哪一天？`,
  extYes: (v) => `${v.ref}（${v.type}，${v.in} 至 ${v.out}）可以延长到 ${v.target}：额外 ${zh.nights(v.nights)}仍剩${zh.rooms(v.left)}，需额外支付 ${rm(v.total)}。我无法更改预订，请在面板上使用 Edit Room。`,
  extNo: (v) => `${v.ref} 无法延长到 ${v.target}：${v.type} 在其中至少一晚已订满。`,
  cancelAlready: (ref) => `${ref} 已经取消。`,
  cancelFree: (v) => `${v.ref} 为 blocked 状态，仍可取消：距入住还有 ${v.hours} 小时（超过72小时）。我无法取消它，请在面板上使用 Cancel。`,
  cancelWithin: (v) => `${v.ref} 距入住已不足72小时（${v.hours} 小时），应已转为确认预订，系统内无法取消。例外情况需通过电话处理。`,
  cancelOther: (v) => `${v.ref} 的状态为 ${v.status}。系统内取消仅适用于距入住超过72小时的 blocked 预订。`,
  w72Title: () => '距入住72小时内的 blocked 预订（应由系统确认并开具发票）：',
  w72Line: (v) => `- ${v.ref}：${v.agent}，${v.type}，入住 ${v.in}（${v.hours} 小时）`,
  w72None: () => '没有距入住72小时内的 blocked 预订。',
  canTitle: () => '仍可取消的 blocked 预订（距入住超过72小时）：',
  canLine: (v) => `- ${v.ref}：${v.agent}，${v.type}，入住 ${v.in}（还剩 ${v.hours} 小时）`,
  canNone: () => '没有仍可取消的 blocked 预订。',
  unpaidTitle: () => '未付款预订（已确认或在住）：',
  unpaidLine: (v) => `- ${v.ref}：${v.by}，${v.in} 至 ${v.out}，${v.amount}`,
  unpaidNone: () => '没有未付款的已确认预订。',
  arrTitle: (d) => `今日抵达（${d}）：`,
  depTitle: (d) => `今日退房（${d}）：`,
  arrNone: (d) => `今天（${d}）没有抵达的客人。`,
  depNone: (d) => `今天（${d}）没有退房的客人。`,
  dayLine: (v) => `- ${v.ref}：${v.by}，${v.type}（${v.status}）`,
  roomNone: (n) => `找不到房间 ${n}。`,
  roomIn: (v) => `房间 ${v.n} 目前由 ${v.name} 入住（${v.ref}，${v.in} 至 ${v.out}）。`,
  roomEmpty: (v) => `房间 ${v.n} 目前没有已入住的客人（房间状态：${v.status}）。`,
  findTitle: () => '找到的预订：',
  findLine: (v) => `- ${v.ref}：${v.who}，${v.type}${v.room ? '，房间 ' + v.room : ''}，${v.in} 至 ${v.out}，${v.status}，${v.pay}`,
  findNone: (x) => `找不到 ${x} 的任何预订。`,
  refuseFinancial: () => '我无法办理退款、折扣、优惠券或更改价格。这些决定须由有相应权限的员工作出。我可以帮您查看价格和空房情况。',
  refuseCancel: () => '我无法取消预订。请在面板上打开该预订并使用 Cancel。如果您提供预订编号，我可以查看它是否仍可取消。',
  help: () => '我可以协助查询指定日期的空房和价格、按客人姓名或预订编号查找预订、未付款预订、接近72小时期限的预订，以及今日抵达或退房的客人。试试：“单人房 11月25日至11月30日”。',
};

const TABLES = { en, ms, zh };
export const messages = (lang) => TABLES[lang] || en;

// Added to the English reply when the staff member writes in a language we do not support.
export const UNSUPPORTED_NOTE =
  'I can only reply in English, Malay or Mandarin. / Saya hanya boleh membalas dalam bahasa Inggeris, Melayu atau Mandarin. / 我只能用英语、马来语或中文回复。';
