export const image=(id,width=1200)=>`https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`
export const rooms=[
 {id:'deluxe-twin',name:'Deluxe Twin',eyebrow:'A LITTLE SPACE TO UNWIND',category:'Classic',rate:220,capacity:2,stock:5,size:28,bed:'2 single beds',image:image('photo-1590490360182-c33d57733427'),description:'An easy, light-filled retreat for two. Natural tones, comfortable twin beds and a quiet corner to settle into after a day out.',features:['Breakfast included','Rain shower','Workspace','Complimentary Wi-Fi']},
 {id:'deluxe-king',name:'Deluxe King',eyebrow:'YOUR OWN SLOW MORNING',category:'Classic',rate:250,capacity:2,stock:4,size:32,bed:'1 king bed',image:image('photo-1611892440504-42a792e24d32'),description:'Room to stretch out, sleep in and make yourself at home. Warm textures meet thoughtful details in a generous king room.',features:['Breakfast included','Rain shower','Lounge chair','Complimentary Wi-Fi']},
 {id:'president-suite',name:'President Suite',eyebrow:'MAKE A LITTLE MORE ROOM',category:'Suite',rate:380,capacity:4,stock:2,size:48,bed:'1 king + sofa bed',image:image('photo-1566665797739-1674de7a421a'),description:'A welcoming space for longer stays and shared moments, with a separate sitting area and room for everyone to feel at ease.',features:['Breakfast included','Separate living area','Bathtub','Complimentary Wi-Fi']}
]
export const dayKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
export const addDays=(key,count)=>{const date=new Date(key+'T12:00:00');date.setDate(date.getDate()+count);return dayKey(date)}
export const money=value=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR',maximumFractionDigits:2}).format(value)
export const dateLabel=key=>new Date(key+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
export function nightsBetween(start,end){return Math.round((Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000)}
export function validateStay(stay,today=dayKey()){
 const nights=nightsBetween(stay.start,stay.end)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(stay.start)||!/^\d{4}-\d{2}-\d{2}$/.test(stay.end)||!Number.isInteger(nights)||nights<1||nights>30||stay.start<today)throw new Error('Choose a future stay of 1–30 nights. Check-out must be after check-in.')
 if(!Number.isInteger(Number(stay.guests))||stay.guests<1||stay.guests>4)throw new Error('Choose 1–4 guests per room.')
 return nights
}
export function availableRooms(room,stay,bookings){
 let remaining=room.stock
 for(let date=stay.start;date<stay.end;date=addDays(date,1)){const booked=bookings.filter(b=>b.room===room.id&&b.start<=date&&date<b.end&&b.status!=='Cancelled').length;remaining=Math.min(remaining,room.stock-booked)}
 return Math.max(0,remaining)
}
export function createBooking(room,stay,guest,bookings,today=dayKey()){
 const nights=validateStay(stay,today)
 if(stay.guests>room.capacity||availableRooms(room,stay,bookings)<1)throw new Error('This room is no longer available for your stay. Please choose another room or date.')
 if(!guest.name?.trim()||!/^\S+@\S+\.\S+$/.test(guest.email||'')||!guest.phone?.trim())throw new Error('Enter your name, a valid email and contact number.')
 return {id:'MH-'+crypto.randomUUID().slice(0,8).toUpperCase(),room:room.id,roomName:room.name,...stay,guests:Number(stay.guests),guest:{...guest,name:guest.name.trim()},nights,total:Math.round(room.rate*100)*nights/100,rate:room.rate,status:'Upcoming',paymentStatus:'Pay at property',source:'Direct website demo',createdAt:new Date().toISOString()}
}
