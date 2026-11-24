import React, { useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { RotateCcw, RotateCw, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, LoaderCircle, Copy, Monitor, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { OwnerQueue } from "./OwnerQueue"
import { ExtensionScreens } from "./ExtensionScreens"
import foundations from "./foundations.html?raw"
import "./legacy.css"
import "./theme.css"

const actions = "flex flex-wrap items-center gap-2"
const control = "min-h-11 h-auto px-4 py-2.5"
const exampleTracks = ["Morning acoustic set", "Late-night listening session", "Evening studio session"]
const description = "text-sm leading-6 text-muted-foreground"
function Action({children,onClick,variant="default",disabled=false,...props}:React.ComponentProps<typeof Button>){
 return <Button variant={variant} disabled={disabled} className={control} onClick={onClick} {...props}>{children}</Button>
}
function DemoCard({title,description:copy,foundation,children}:{title:string,description:string,foundation:string,children:ReactNode}){
 return <Card className="min-w-0 gap-6 rounded-xl py-6 shadow-none">
  <CardHeader className="gap-2 px-6"><CardTitle className="text-base leading-6">{title}</CardTitle><CardDescription className="text-sm leading-5">{copy}</CardDescription><p className="text-xs leading-5 text-muted-foreground break-words">{foundation}</p></CardHeader>
  <CardContent className="min-w-0 space-y-4 px-6">{children}</CardContent>
 </Card>
}
function Field({id,label,children,hint}:{id:string,label:string,children:ReactNode,hint?:string}){
 return <div className="grid gap-2"><Label htmlFor={id} className="text-sm leading-5">{label}</Label>{children}{hint&&<p className="text-xs leading-5 text-muted-foreground">{hint}</p>}</div>
}
function Connection({kind="online",children}:{kind?:string,children:ReactNode}){
 const color=kind==="active"?"text-[#72dfaa]":kind==="pending"?"text-[#f6cc76]":"text-muted-foreground"
 return <Badge variant="outline" className={"gap-2 px-2.5 py-1 text-xs leading-5 "+color}><span aria-hidden="true" className="size-1.5 rounded-full bg-current"/>{children}</Badge>
}
function Seek({direction,onClick}:{direction:"back"|"forward",onClick:()=>void}){
 const Icon=direction==="back"?RotateCcw:RotateCw
 return <Button variant="ghost" size="icon" className="relative size-12 rounded-full" onClick={onClick} aria-label={direction==="back"?"Rewind ten seconds":"Forward ten seconds"}><Icon className="size-7"/><span aria-hidden="true" className="absolute top-[20px] left-[19px] text-[8px] leading-none font-bold">10</span></Button>
}
function time(seconds:number){return Math.floor(seconds/60)+"∶"+String(seconds%60).padStart(2,"0")}
function App(){
 const [notice,setNotice]=useState("")
 const [playing,setPlaying]=useState(true)
 const [trackIndex,setTrackIndex]=useState(1)
 const [position,setPosition]=useState(64)
 const [volume,setVolume]=useState(70)
 const [muted,setMuted]=useState(false)
 const [approval,setApproval]=useState("pending")
 const [receiver,setReceiver]=useState("mac")
 const [deviceName,setDeviceName]=useState("My MacBook")
 const [pin,setPin]=useState("")
 const [pinError,setPinError]=useState("")
 const [pairing,setPairing]=useState(false)
 const [code,setCode]=useState("482916")
 const [nickname,setNickname]=useState("")
 const [joined,setJoined]=useState(false)
 const [guestOpen,setGuestOpen]=useState(false)
 const [video,setVideo]=useState("")
 const [videoError,setVideoError]=useState("")
 const [query,setQuery]=useState("")
 const [searchDone,setSearchDone]=useState(false)
 const [searchError,setSearchError]=useState("")
 const [notifications,setNotifications]=useState(true)
 const [paired,setPaired]=useState(true)
 const [replaceOpen,setReplaceOpen]=useState(false)
 const [queue,setQueue]=useState([{id:1,title:"Studio session",by:"You"},{id:2,title:"Acoustic set",by:"Maya"}])
 const [guestQueue,setGuestQueue]=useState<string[]>([])
 const [tab,setTab]=useState("remote")
 const [reconnecting,setReconnecting]=useState(false)
 function say(value:string){setNotice(value)}
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(""),4000);return()=>clearTimeout(timer)},[notice])
 useEffect(()=>{
  const select=document.getElementById("font-choice") as HTMLSelectElement|null
  const listener=()=>{const sample=document.getElementById("type-sample");if(sample&&select)sample.style.fontFamily=select.value}
  select?.addEventListener("change",listener)
  const handlers:Array<[HTMLElement,()=>void]>=[]
  document.querySelectorAll<HTMLElement>("[data-copy]").forEach(button=>{const handler=async()=>{try{await navigator.clipboard.writeText(button.dataset.copy||"");say("Color copied.")}catch{say("Color value "+button.dataset.copy)}};button.addEventListener("click",handler);handlers.push([button,handler])})
  return()=>{select?.removeEventListener("change",listener);handlers.forEach(([b,h])=>b.removeEventListener("click",h))}
 },[])
 function addOwner(title="Example linked video"){setQueue(items=>[...items,{id:Date.now(),title,by:"You"}]);say("Example video added to queue.")}
 function pair(e:React.FormEvent){e.preventDefault();if(!/^\d{6}$/.test(pin)){setPinError("Enter exactly six digits.");return}setPinError("");setPairing(true);say("Demo pairing request sent. Desktop confirmation is required.")}
 function addGuest(e:React.FormEvent){e.preventDefault();let valid=false;try{const u=new URL(video);valid=u.protocol==="https:"&&((["youtube.com","www.youtube.com","m.youtube.com"].includes(u.hostname)&&((u.pathname==="/watch"&&/^[\w-]{11}$/.test(u.searchParams.get("v")||""))||/^\/(shorts|live)\/[\w-]{11}\/?$/.test(u.pathname)))||(u.hostname==="youtu.be"&&/^\/[\w-]{11}\/?$/.test(u.pathname)))}catch{}if(!valid){setVideoError("Enter a valid HTTPS YouTube video link.");return}setVideoError("");setGuestQueue(items=>[...items,"Example linked video"]);setVideo("");say("Example video added to guest queue.")}
 return <>
 <div style={{display:"contents"}} dangerouslySetInnerHTML={{__html:foundations}}/>
 <main className="wrap">
 <section id="components" className="section">
  <div className="section-head"><h2>Shared UI components</h2><p>Official shadcn components with proposed RELO colors. Keyboard support and interaction behavior come from the installed components.</p></div>
  <div className="grid gap-6 md:grid-cols-2">
   <DemoCard title="Buttons and feedback" description="44 px action targets, 8 px between actions, and clear action hierarchy." foundation="Button · Badge">
    <div className={actions}><Action onClick={()=>say("Example action completed.")}>Play next</Action><Action variant="secondary" onClick={()=>addOwner()}>Add to queue</Action><Action variant="ghost" onClick={()=>say("Example cancelled.")}>Cancel</Action><Action disabled><LoaderCircle className="size-4 animate-spin"/>Connecting</Action></div>
    <div className={actions}><Connection>Online</Connection><Connection kind="pending">Approval pending</Connection><Connection kind="active">Authorized</Connection><Connection>Offline</Connection></div>
   </DemoCard>
   <DemoCard title="Fields and switches" description="8 px label spacing and 16 px between related controls." foundation="Input · Label · Switch">
    <Field id="sample-name" label="Device name"><Input id="sample-name" className="min-h-11" value={deviceName} onChange={e=>setDeviceName(e.target.value)}/></Field>
    <div className="flex items-center justify-between gap-4"><Label htmlFor="notifications" className="min-h-11 flex-1 cursor-pointer leading-5">Connection notifications</Label><Switch id="notifications" checked={notifications} onCheckedChange={setNotifications}/></div>
   </DemoCard>
  </div>
 </section>
 <section id="phone" className="section"><span id="patterns" className="sr-only">Phone playback</span>
  <div className="section-head"><h2>Phone screens & controls</h2><p>Shadcn sliders and buttons combined with Lucide seek icons. This demonstration changes local example state.</p></div>
  <div className="grid gap-6 md:grid-cols-2">
   <DemoCard title="Owner remote" description="Playback stays on the desktop. The phone shows metadata and controls." foundation="Card · Button · Slider · Badge">
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 font-semibold"><Monitor className="size-4"/>{deviceName||"My MacBook"}</span><Connection kind="active">Demo authorized</Connection></div>
    <div className="space-y-1"><p className="text-xl font-semibold leading-7">{exampleTracks[trackIndex]}</p><p className={description}>Example video · 4 min 12 sec</p></div>
    <div className="space-y-2"><Label htmlFor="playback-position">Playback position</Label><Slider id="playback-position" className="min-h-8" aria-label="Playback position" min={0} max={252} value={[position]} onValueChange={v=>setPosition(v[0])}/><div className="flex justify-between text-xs text-muted-foreground"><span>{time(position)}</span><span>4∶12</span></div></div>
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
     <Button variant="ghost" size="icon" className="size-12 rounded-full" aria-label="Previous track" disabled={trackIndex===0} onClick={()=>{setTrackIndex(index=>Math.max(0,index-1));setPosition(0);say("Demo previous track selected.")}}><SkipBack className="size-6"/></Button>
     <Seek direction="back" onClick={()=>setPosition(Math.max(0,position-10))}/>
     <Button size="icon" className="size-14 rounded-full" aria-label={playing?"Pause":"Play"} onClick={()=>setPlaying(!playing)}>{playing?<Pause className="size-6"/>:<Play className="size-6"/>}</Button>
     <Seek direction="forward" onClick={()=>setPosition(Math.min(252,position+10))}/>
     <Button variant="ghost" size="icon" className="size-12 rounded-full" aria-label="Next video" disabled={trackIndex===exampleTracks.length-1} onClick={()=>{setTrackIndex(index=>Math.min(exampleTracks.length-1,index+1));setPosition(0);say("Demo next track selected.")}}><SkipForward className="size-6"/></Button>
    </div>
   </DemoCard>
   <DemoCard title="Volume and receiver approval" description="Volume support depends on the receiver. New sessions require desktop approval." foundation="Slider · Button · Badge">
    <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={muted?"Unmute":"Mute"} aria-pressed={muted} onClick={()=>setMuted(!muted)}>{muted?<VolumeX/>:<Volume2/>}</Button><Slider className="min-h-8" aria-label="Desktop volume" value={[muted?0:volume]} max={100} onValueChange={v=>{setVolume(v[0]);setMuted(false)}}/><span className="w-10 text-sm tabular-nums">{muted?0:volume}%</span></div>
    <div className="border-t border-border pt-4 space-y-4"><Connection kind={approval==="approved"?"active":"pending"}>{approval==="approved"?"Authorized":approval==="denied"?"Request denied":"Approval pending"}</Connection><p className={description}>Allow Leon’s phone to control this browser?</p><div className={actions}><Action disabled={approval!=="pending"} onClick={()=>setApproval("approved")}>Approve session</Action><Action variant="outline" disabled={approval!=="pending"} onClick={()=>setApproval("denied")}>Deny</Action><Action variant="ghost" onClick={()=>setApproval("pending")}>Reset</Action></div></div>
   </DemoCard>
  </div>
 </section>
 <ExtensionScreens/>
 <section id="catalog" className="section">
  <div className="section-head"><h2>Product component catalog</h2><p>Consistent 24 px card padding and section gaps. Related controls use 16 px spacing, with 8 px label and action gaps.</p></div>
  <p className="note">Proposed components for the planned product. All examples run locally. Optional and later features are marked.</p>
<div id="phone-components" data-platform="phone" className="mb-8"><h3 className="mb-2 text-xl">Phone components</h3><p className="note">Owner remote, guest queue, and mobile navigation.</p><div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">   <DemoCard title="Receiver selector" description="Choose a paired desktop. Reachability and authorization remain distinct." foundation="Select · Badge · Button">
    <Field id="receiver" label="Receiver"><Select value={receiver} onValueChange={setReceiver}><SelectTrigger id="receiver" className="min-h-11 w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="mac">My MacBook · Online</SelectItem><SelectItem value="pc">Living room PC · Offline</SelectItem></SelectContent></Select></Field>
    <Action disabled={receiver==="pc"} onClick={()=>say("Demo control request sent for desktop approval.")}>Request control</Action>
    {receiver==="pc"&&<p className={description}>Open Chrome on the desktop to reconnect.</p>}
   </DemoCard>   <DemoCard title="Pairing entry" description="Enter six digits on mobile, then confirm on the desktop." foundation="Input · Label · Button">
    <form className="space-y-4" onSubmit={pair} noValidate><Field id="pair-pin" label="Pairing PIN"><Input id="pair-pin" className="min-h-11 font-sans tracking-widest" inputMode="numeric" maxLength={6} value={pin} onChange={e=>{setPin(e.target.value);setPairing(false)}} placeholder="Six-digit PIN" aria-invalid={!!pinError} aria-describedby="pair-error"/></Field>{pinError&&<p id="pair-error" role="alert" className="text-sm text-destructive">{pinError}</p>}<Action type="submit" disabled={pairing}>{pairing?"Awaiting desktop":"Request pairing"}</Action></form>
   </DemoCard>   <DemoCard title="YouTube search" description="Search by title or use a video link when search is unavailable." foundation="Input · Label · Button">
    <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!query.trim()){setSearchError("Enter a search term.");return}setSearchError("");setSearchDone(true)}}><Field id="search" label="Search YouTube"><Input id="search" className="min-h-11" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search videos" aria-describedby="search-feedback"/></Field><Action type="submit">Search</Action><p id="search-feedback" role="status" className={description}>{searchError||(searchDone?"Example results are shown in the result card.":"")}</p></form>
   </DemoCard>   <DemoCard title="Video result" description="Show title, channel, duration, and owner actions." foundation="Card · Button">
    <div className="space-y-1"><p className="font-semibold">Evening studio session</p><p className={description}>Example channel · 12 min</p></div>
    <div className={actions}><Action onClick={()=>setReplaceOpen(true)}>Play now</Action><Action variant="secondary" onClick={()=>{setQueue(items=>[{id:Date.now(),title:"Evening studio session",by:"You"},...items]);say("Example video placed next.")}}>Play next</Action><Action variant="outline" onClick={()=>addOwner("Evening studio session")}>Queue</Action></div>
   </DemoCard>   <DemoCard title="Replace playback" description="Confirm when an action interrupts the current video." foundation="Dialog · Button">
    <Action variant="outline" onClick={()=>setReplaceOpen(true)}>Replace current video</Action><p className={description}>The confirmation identifies the receiving desktop.</p>
   </DemoCard>   <DemoCard title="Owner queue" description="Drag the six-dot handle to reorder upcoming videos. Contributor names stay visible." foundation="Card · Button · Sortable list">
    <OwnerQueue items={queue} onChange={setQueue}/>
   </DemoCard>   <DemoCard title="Guest join" description="A nickname identifies contributions in a temporary guest session." foundation="Input · Label · Button">
    <Field id="nickname" label="Nickname"><Input id="nickname" className="min-h-11" value={nickname} maxLength={30} onChange={e=>{setNickname(e.target.value);setJoined(false)}} placeholder="Your name"/></Field><Action disabled={!nickname.trim()||joined} onClick={()=>{setJoined(true);say("Demo guest joined.")}}>{joined?"Joined example queue":"Join queue"}</Action>
   </DemoCard>   <DemoCard title="Guest contribution" description="Guests add upcoming videos to the host’s queue." foundation="Input · Label · Button">
    <form onSubmit={addGuest} className="space-y-4" noValidate><Field id="guest-link" label="YouTube video link"><Input id="guest-link" className="min-h-11" value={video} onChange={e=>setVideo(e.target.value)} placeholder="https://youtu.be/…" aria-invalid={!!videoError} aria-describedby="link-error"/></Field>{videoError&&<p id="link-error" role="alert" className="text-sm text-destructive">{videoError}</p>}<Action type="submit" variant="secondary">Add to queue</Action></form><ul className="space-y-2">{guestQueue.map((title,i)=><li className="text-sm" key={i}>{title}<span className="block text-xs text-muted-foreground">Added by {nickname||"Guest"}</span></li>)}</ul>
   </DemoCard>   <DemoCard title="Host guest access" description="The owner controls temporary queue contribution access." foundation="Switch · Label · Button">
    <div className="flex items-center justify-between gap-4"><Label htmlFor="guest-access" className="min-h-11 flex-1 cursor-pointer leading-5">Allow guest contributions</Label><Switch id="guest-access" checked={guestOpen} onCheckedChange={setGuestOpen}/></div><p className={description}>{guestOpen?"Guest contributions enabled in this example.":"Guest access is closed."}</p><Action variant="outline" disabled={!guestOpen} onClick={()=>say("A real invite would be generated for this temporary session.")}><Copy className="size-4"/>Copy invite example</Action>
   </DemoCard>   <DemoCard title="Product navigation" description="Owner navigation separates remote controls, queue, and devices." foundation="Tabs">
    <Tabs id="product-navigation" value={tab} onValueChange={setTab} className="gap-4"><TabsList variant="line" className="w-full"><TabsTrigger value="remote" className="min-h-11">Remote</TabsTrigger><TabsTrigger value="queue" className="min-h-11">Queue</TabsTrigger><TabsTrigger value="devices" className="min-h-11">Devices</TabsTrigger></TabsList><TabsContent value="remote" className={description}>Playback controls</TabsContent><TabsContent value="queue" className={description}>{queue.length} upcoming example videos</TabsContent><TabsContent value="devices" className={description}>My MacBook · Online</TabsContent></Tabs>
   </DemoCard>   <DemoCard title="Native share actions" description="Android sharing follows the MVP. A current approval is required for playback." foundation="Dialog · Button · Badge">
    <Badge variant="outline">Later phase</Badge><Dialog><DialogTrigger asChild><Action variant="outline">Preview share actions</Action></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Send to My MacBook</DialogTitle><DialogDescription>Example authorized session. Choose where to place the video.</DialogDescription></DialogHeader><div className="grid gap-2"><Action onClick={()=>say("Example play now selected.")}>Play now</Action><Action variant="secondary" onClick={()=>say("Example play next selected.")}>Play next</Action><Action variant="outline" onClick={()=>addOwner()}>Add to queue</Action></div></DialogContent></Dialog>
   </DemoCard></div></div><div id="extension-components" data-platform="extension" className="mb-8"><h3 className="mb-2 text-xl">Extension components</h3><p className="note">Browser registration, pairing, and receiver management.</p><div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">   <DemoCard title="Receiver registration" description="Name the desktop browser so it is easy to recognize." foundation="Input · Label · Button">
    <Field id="receiver-name" label="Device name"><Input id="receiver-name" className="min-h-11" value={deviceName} onChange={e=>setDeviceName(e.target.value)}/></Field>
    <Action variant="secondary" disabled={!deviceName.trim()} onClick={()=>say("Example device name saved.")}>Save name</Action>
   </DemoCard>   <DemoCard title="Pairing code" description="The desktop displays a single-use code with an expiry." foundation="Card · Button · Badge">
    <p className="text-3xl font-sans tracking-[.25em] tabular-nums">{code.slice(0,3)} {code.slice(3)}</p><Badge variant="outline">Example expiry · 1 min 30 sec</Badge>
    <Action variant="outline" onClick={()=>{setCode(code==="482916"?"739124":"482916");say("Example PIN regenerated.")}}>Generate new PIN</Action>
   </DemoCard>   <DemoCard title="Pairing confirmation" description="Desktop confirmation registers a phone for future session requests." foundation="Dialog · Button">
    <Dialog><DialogTrigger asChild><Action variant="outline">Review new phone</Action></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Pair Leon’s phone?</DialogTitle><DialogDescription>Confirm this is the phone that requested the pairing code. Each new control session will still require approval.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Action onClick={()=>say("Demo phone registered.")}>Confirm pairing</Action></DialogClose></DialogFooter></DialogContent></Dialog>
   </DemoCard>   <DemoCard title="Paired controllers" description="Review trusted phones and revoke their pairing." foundation="Card · Dialog · Button">
    <div className="flex items-center gap-3"><Smartphone className="size-5"/><div><p className="font-medium">Leon’s phone</p><p className={description}>{paired?"Paired controller":"Pairing revoked"}</p></div></div>
    <Dialog><DialogTrigger asChild><Action variant="outline" disabled={!paired}>Revoke pairing</Action></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Revoke this phone’s pairing?</DialogTitle><DialogDescription>The phone will need to pair again before requesting control.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Action onClick={()=>{setPaired(false);say("Example pairing revoked.")}}>Revoke pairing</Action></DialogClose></DialogFooter></DialogContent></Dialog>
   </DemoCard>   <DemoCard title="Notification settings" description="Approval stays accessible in the extension when notifications are unavailable." foundation="Switch · Alert · Button">
    <div className="flex items-center justify-between gap-4"><Label htmlFor="settings-notifications" className="min-h-11 flex-1 cursor-pointer leading-5">Connection notifications</Label><Switch id="settings-notifications" checked={notifications} onCheckedChange={setNotifications}/></div>
    <p className={description}>Open the extension to review incoming requests.</p><Action variant="outline" onClick={()=>say("Demo help only. Browser permission settings were unchanged.")}>Notification help</Action>
   </DemoCard></div></div><div id="shared-components" data-platform="shared" className="mb-8"><h3 className="mb-2 text-xl">Shared product states</h3><p className="note">Reusable status, loading, and recovery patterns. Account sign-in is deferred.</p><div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">   <DemoCard title="Session lifecycle" description="Show expiry, authorization, and termination in plain language." foundation="Badge · Alert · Button">
    <div className={actions}><Connection kind="pending">Pending</Connection><Connection kind="active">Authorized</Connection><Connection>Expired</Connection></div>
    <Alert><AlertTitle>Session expired</AlertTitle><AlertDescription>Request a new session and approve it on the desktop.</AlertDescription></Alert>
    <Action variant="outline" onClick={()=>say("Demo session disconnected.")}>Disconnect</Action>
   </DemoCard>   <DemoCard title="Loading and empty states" description="Explain pending operations and give empty screens a next action." foundation="Button · Card">
    <Action disabled><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none"/>Requesting session</Action><div className="space-y-2 border-t border-border pt-4"><p className="font-medium">Your queue is empty</p><p className={description}>Search YouTube or paste a link to add your first video.</p></div>
   </DemoCard>   <DemoCard title="Errors and recovery" description="Handle offline receivers, search limits, and interrupted sessions." foundation="Alert · Button">
    <Alert><AlertTitle>Receiver offline</AlertTitle><AlertDescription>Open Chrome on the desktop, then request a new session.</AlertDescription></Alert>
    <Action variant="outline" disabled={reconnecting} onClick={()=>{setReconnecting(true);setTimeout(()=>{setReconnecting(false);say("Demo retry completed. A real receiver would be checked again.")},800)}}>{reconnecting?<LoaderCircle className="size-4 animate-spin"/>:null}{reconnecting?"Reconnecting":"Try again"}</Action>
   </DemoCard>   <DemoCard title="Account sign-in · deferred" description="Account sign-in will be revisited after the core product." foundation="Button · Badge">
    <Badge variant="outline">Deferred</Badge><Action variant="outline" onClick={()=>say("Example sign-in only. Authentication is not connected.")}>Continue with Google</Action><p className={description}>Pairing and session approval still apply.</p>
   </DemoCard></div></div>
 </section>
 <section id="handoff" className="section">
  <div className="section-head"><h2>Shared design reference</h2><p>Proposed interface foundations using the installed shadcn components. Review these choices before production implementation.</p></div>
  <div className="grid gap-6 md:grid-cols-2"><DemoCard title="Spacing system" description="Shadcn Card defaults establish the structure. RELO extends controls for comfortable phone use." foundation="Card · CardHeader · CardContent">
   <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><dt>Card padding</dt><dd>24 px</dd><dt>Header to content</dt><dd>24 px</dd><dt>Related fields</dt><dd>16 px</dd><dt>Label to input</dt><dd>8 px</dd><dt>Action gap</dt><dd>8 px</dd><dt>Touch controls</dt><dd>44 px minimum</dd></dl>
  </DemoCard><DemoCard title="Source and review status" description="Logo assets retain the provenance recorded in the logo guidelines. Interface colors and components remain proposals." foundation="RELO · Draft 0.4">
   <p className={description}>This self-contained HTML includes the React component behavior and embedded logo assets. Product networking and playback use demonstration data.</p><a className="text-sm underline" href="https://ui.shadcn.com/docs/components/card" target="_blank" rel="noopener">Shadcn Card documentation</a>
  </DemoCard></div>
 </section>
 </main>
 <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}><DialogContent><DialogHeader><DialogTitle>Replace current video?</DialogTitle><DialogDescription>The selected video will take over playback on {deviceName||"My MacBook"}.</DialogDescription></DialogHeader><DialogFooter><Action variant="outline" onClick={()=>setReplaceOpen(false)}>Cancel</Action><Action onClick={()=>{setReplaceOpen(false);setPosition(0);say("Example current video replaced.")}}>Replace video</Action></DialogFooter></DialogContent></Dialog>
 <div role="status" aria-live="polite" className={notice?"fixed bottom-6 left-1/2 z-[100] w-[calc(100%-40px)] max-w-md -translate-x-1/2 rounded-xl border border-border bg-secondary px-5 py-3 text-sm text-foreground shadow-xl":""}>{notice}</div>
 <footer className="wrap">RELO · Working design reference 0.4 · Local examples · Proposed interface foundations</footer>
 </>
}
createRoot(document.getElementById("root")!).render(<App/>)
