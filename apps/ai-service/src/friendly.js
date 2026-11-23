// Fixed friendly lines (the model never writes them). The Malay and Mandarin wording was drafted by AI and needs a native reader.
const F = {
  en: {
    smalltalk: 'Happy to help! I can check room availability and rates, look up bookings, and list today’s arrivals, departures and unpaid bookings. What would you like to check?',
    confirmNothing: 'Happy to help with that. Which room type and dates should I use? For example: “25-30 Nov”.',
  },
  ms: {
    smalltalk: 'Dengan senang hati! Saya boleh menyemak ketersediaan dan kadar bilik, mencari tempahan, serta menyenaraikan ketibaan, daftar keluar dan tempahan belum dibayar hari ini. Apa yang anda mahu semak?',
    confirmNothing: 'Boleh. Jenis bilik dan tarikh yang mana? Contoh: “25-30 Nov”.',
  },
  zh: {
    smalltalk: '很乐意帮忙！我可以查询房间空房和价格、查找订单，以及列出今天的抵店、离店和未付款订单。您想查询什么？',
    confirmNothing: '好的。请问要用哪种房型和哪几天？例如：“25-30 Nov”。',
  },
};
export const friendly = (lang) => F[lang] || F.en;
