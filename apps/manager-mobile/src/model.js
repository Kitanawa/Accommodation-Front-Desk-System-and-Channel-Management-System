export const money=value=>`RM ${Number(value).toFixed(2)}`
export const dateLabel=value=>new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
export function seedRequests(){const now=Date.now();return [
 {id:'REQ-0042',kind:'Room Rate',name:'Deluxe Twin',category:'Standard Rooms',subtitle:'Weekend pricing update',submittedBy:'f-staff',submittedAt:new Date(now-18*60000).toISOString(),status:'Pending',reason:'Adjust the weekend rate for the upcoming holiday period. Weekday pricing remains unchanged.',current:220,proposed:250,guests:2,stock:5,remark:'Base rate review for the upcoming season.',rules:[{type:'Date Range',condition:'01–30 Nov 2026',current:220,proposed:240,prior:10,remark:'November seasonal rate'},{type:'Selected Day',condition:'Friday, Saturday',current:260,proposed:280,prior:20,remark:'Weekend pricing'},{type:'Specific Date',condition:'25 Dec 2026',current:300,proposed:320,prior:30,remark:'Holiday pricing'}]},
 {id:'REQ-0041',kind:'Room Type',name:'Garden Suite',category:'Suites',subtitle:'New room type & pricing',submittedBy:'f-staff 2',submittedAt:new Date(now-52*60000).toISOString(),status:'Pending',reason:'Add the Garden Suite to the available room catalogue, including its complete pricing configuration.',current:null,proposed:380,guests:4,stock:2,facilities:'King bed, sofa bed, separate living area, breakfast, Wi-Fi',remark:'New room type. Available for booking only after approval.',rules:[{type:'Selected Day',condition:'Friday, Saturday',current:null,proposed:420,prior:20,remark:'Weekend suite rate'}]},
 {id:'REQ-0040',kind:'Room Rate',name:'Deluxe King',category:'Standard Rooms',subtitle:'Base rate adjustment',submittedBy:'Admin 1',submittedAt:new Date(now-2*3600000).toISOString(),status:'Pending',reason:'Update the base nightly rate while retaining existing special-day rules.',current:250,proposed:270,guests:2,stock:4,remark:'Standard nightly rate update.',rules:[]},
 {id:'REQ-0039',kind:'Room Rate',name:'Superior Twin',category:'Standard Rooms',subtitle:'Base rate review',submittedBy:'f-staff',submittedAt:new Date(now-26*3600000).toISOString(),status:'Approved',current:180,proposed:200,remark:'Reviewed sample request.',reason:'Base price update.',rules:[],reviewedBy:'manager 1',reviewedAt:new Date(now-24*3600000).toISOString(),reviewRemark:'Pricing checked.'}
 ]}
export function reviewRequest(request,action,remark,role='manager',stamp=new Date().toISOString()){
 if(role!=='manager')throw new Error('Only Manager can review requests.')
 if(request.status!=='Pending')throw new Error('This request has already been reviewed.')
 if(!['approve','reject'].includes(action))throw new Error('Invalid review action.')
 if(action==='reject'&&!remark.trim())throw new Error('Please enter a rejection reason.')
 if(action==='approve'&&request.kind==='Room Type'&&!request.stock)throw new Error('Add physical rooms before approving this room type.')
 return {...request,status:action==='approve'?'Approved':'Rejected',reviewedBy:'manager 1',reviewedAt:stamp,reviewRemark:remark.trim()}
}
export function notificationFor(request){return {id:'N-'+request.id,requestId:request.id,title:request.kind==='Room Type'?'New room type to review':'Room rate change requested',body:`${request.submittedBy} submitted ${request.name}.`,date:request.submittedAt}}
