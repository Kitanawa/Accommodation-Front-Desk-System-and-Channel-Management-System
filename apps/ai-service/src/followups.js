// Follow-up question and page action for every reply. Fixed text only: the model never writes these.
// followUp = one relevant next question (client request: "would you like to book?") plus buttons.
//   button type 'select_stay': the page selects these dates on the Booking page (staff still press Continue; nothing is booked).
//   button type 'ask': the popup sends this English question again, with the reply language forced to the current one.
// action = the same select_stay instruction, sent automatically when an availability question can be answered.
// The Malay and Mandarin wording was drafted by AI and needs a native reader.

const T = {
  en: {
    book: 'Would you like to book it? I can select these dates on the Booking page, and you press Continue.',
    none: 'Would you like to try other dates or another room type?',
    roomInfo: 'Would you like to check availability for a stay? For example: 25-30 Nov.',
    lookupOne: 'Would you like to look up one of these bookings? Type its reference (for example R-ABC123) or the guest name.',
    lookupAnother: 'Would you like to look up another booking? Type its reference (for example R-ABC123) or the guest name.',
    cancelQ: 'Would you like to check whether this booking can be cancelled?',
    generic: 'Would you like to check room availability? For example: 25-30 Nov.',
    select: 'Select these dates', arrivals: 'Arrivals today', departures: 'Departures today', unpaid: 'Unpaid bookings', capacity: 'Room capacity', cancelBtn: 'Can it be cancelled?',
  },
  ms: {
    book: 'Adakah anda mahu menempahnya? Saya boleh memilih tarikh ini di halaman Booking, dan anda menekan Continue.',
    none: 'Adakah anda mahu mencuba tarikh lain atau jenis bilik lain?',
    roomInfo: 'Adakah anda mahu menyemak ketersediaan untuk satu penginapan? Contoh: 25-30 Nov.',
    lookupOne: 'Adakah anda mahu menyemak salah satu tempahan ini? Taip rujukan tempahan (contoh R-ABC123) atau nama tetamu.',
    lookupAnother: 'Adakah anda mahu menyemak tempahan lain? Taip rujukan tempahan (contoh R-ABC123) atau nama tetamu.',
    cancelQ: 'Adakah anda mahu menyemak sama ada tempahan ini boleh dibatalkan?',
    generic: 'Adakah anda mahu menyemak ketersediaan bilik? Contoh: 25-30 Nov.',
    select: 'Pilih tarikh ini', arrivals: 'Ketibaan hari ini', departures: 'Daftar keluar hari ini', unpaid: 'Tempahan belum dibayar', capacity: 'Kapasiti bilik', cancelBtn: 'Boleh dibatalkan?',
  },
  zh: {
    book: '需要预订吗？我可以在 Booking 页面选好这些日期，由您按 Continue 继续。',
    none: '要试试其他日期或其他房型吗？',
    roomInfo: '要查询某段住宿的空房情况吗？例如：25-30 Nov。',
    lookupOne: '要查询其中一个预订吗？请输入预订编号（例如 R-ABC123）或客人姓名。',
    lookupAnother: '要查询其他预订吗？请输入预订编号（例如 R-ABC123）或客人姓名。',
    cancelQ: '要查看这个预订是否可以取消吗？',
    generic: '要查询房间空房情况吗？例如：25-30 Nov。',
    select: '选择这些日期', arrivals: '今天入住', departures: '今天退房', unpaid: '未付款预订', capacity: '房间容量', cancelBtn: '可以取消吗？',
  },
};

const ask = (label, message) => ({ type: 'ask', label, message });
const stay = (room_type, req) => ({ type: 'select_stay', room_type, from: req.from, to: req.to });

// The page action: select the stay (check-out day not counted) when an availability question can be answered.
// ctx.bookable = room types the database says can be booked (undefined when no data was read).
export function buildAction({ req, problem, ctx = {}, tdy }) {
  if (problem || req.intent !== 'availability' || !req.from || !req.to || req.from < tdy) return null;
  if (ctx.bookable) {
    if (req.room_type) return ctx.bookable.includes(req.room_type) ? stay(req.room_type, req) : null;
    return ctx.bookable.length ? stay(null, req) : null;
  }
  return stay(req.room_type || null, req); // no data read: the page checks with the data it has
}

export function buildFollowUp(lang, { req, problem, ctx = {}, tdy }) {
  const t = T[lang] || T.en;
  const generic = { text: t.generic, buttons: [ask(t.arrivals, 'arrivals today'), ask(t.unpaid, 'unpaid bookings')] };
  if (problem) return generic;
  switch (req.intent) {
    case 'availability': {
      if (!req.from || !req.to || req.from < tdy) return generic;
      let types;
      if (ctx.bookable) {
        if (req.room_type ? !ctx.bookable.includes(req.room_type) : ctx.bookable.length === 0) return { text: t.none, buttons: [ask(t.capacity, 'how many people can each room type fit')] };
        types = req.room_type ? [req.room_type] : ctx.bookable.slice(0, 4);
      } else types = [req.room_type || null];
      return { text: t.book, buttons: types.map((n) => ({ ...stay(n, req), label: types.length === 1 ? t.select : n })) };
    }
    case 'room_info': return { text: t.roomInfo, buttons: [] };
    case 'arrivals': return { text: t.lookupOne, buttons: [ask(t.departures, 'departures today'), ask(t.unpaid, 'unpaid bookings')] };
    case 'departures': return { text: t.lookupOne, buttons: [ask(t.arrivals, 'arrivals today'), ask(t.unpaid, 'unpaid bookings')] };
    case 'unpaid': return { text: t.lookupOne, buttons: [ask(t.arrivals, 'arrivals today'), ask(t.departures, 'departures today')] };
    case 'booking_lookup':
      return req.booking_ref ? { text: t.cancelQ, buttons: [ask(t.cancelBtn, `Can ${req.booking_ref} be cancelled?`)] } : { text: t.lookupAnother, buttons: [] };
    case 'cancel_check': return { text: t.lookupAnother, buttons: [] };
    default: return generic;
  }
}
