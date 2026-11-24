import React, { useEffect, useState, type ReactNode } from "react"
import { Monitor, Smartphone, ShieldCheck, WifiOff, Settings2, Link2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import logo from "../../RELO_Logo_Assets/icons/relo-icon-48.png"

type ReceiverState="ready"|"pending"|"active"|"denied"|"expired"|"offline"
type PairingState="code"|"confirm"|"paired"|"expired"
const copy:Record<ReceiverState,{label:string;title:string;body:string}>={
 ready:{label:"Online",title:"Ready for your phone",body:"Pair a phone, then approve each new control session here."},
 pending:{label:"Approval pending",title:"Leon’s phone wants control",body:"Review the request before this phone can navigate or play videos."},
 active:{label:"Authorized",title:"Leon’s phone is connected",body:"This phone can control the designated YouTube tab during this session."},
 denied:{label:"Request denied",title:"Request declined",body:"The phone can send a new request when you are ready."},
 expired:{label:"Session expired",title:"A fresh approval is needed",body:"The phone must request a new session before controlling playback."},
 offline:{label:"Offline",title:"Receiver disconnected",body:"Check the connection. Access will be checked again after reconnecting."}
}
const button="min-h-11 h-auto px-4 py-2.5"
function Preview({title,description,children}:{title:string;description:string;children:ReactNode}){
 return <Card className="min-w-0 gap-6 py-6 shadow-none">
  <CardHeader className="gap-2 px-6"><CardTitle className="text-lg leading-6">{title}</CardTitle><CardDescription className="text-sm leading-5">{description}</CardDescription></CardHeader>
  <CardContent className="min-w-0 px-6">{children}</CardContent>
 </Card>
}
function Frame({children,label}:{children:ReactNode;label:string}){
 return <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-border bg-background" role="region" aria-label={label}>
  <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div className="flex items-center gap-2"><img src={logo} className="size-7" alt=""/><span className="text-base font-bold tracking-[.2em]">RELO</span></div><span className="text-xs text-muted-foreground">Desktop receiver</span></div>
  <div className="space-y-5 p-5">{children}</div>
 </div>
}
function Status({state}:{state:ReceiverState}){
 const color=state==="active"?"text-[#72dfaa]":state==="pending"?"text-[#f6cc76]":"text-muted-foreground"
 return <Badge variant="outline" className={"gap-2 px-2.5 py-1 text-xs "+color}><span className="size-1.5 rounded-full bg-current" aria-hidden="true"/>{copy[state].label}</Badge>
}
export function ExtensionScreens(){
 const [state,setState]=useState<ReceiverState>("ready")
 const [pairing,setPairing]=useState<PairingState>("code")
 const [code,setCode]=useState("482916")
 const [seconds,setSeconds]=useState(120)
 const [notifications,setNotifications]=useState(true)
 const [phonePaired,setPhonePaired]=useState(false)
 const [message,setMessage]=useState("")
 useEffect(()=>{
  if(pairing!=="code"&&pairing!=="confirm")return
  const timer=setInterval(()=>setSeconds(value=>Math.max(0,value-1)),1000)
  return()=>clearInterval(timer)
 },[pairing])
 useEffect(()=>{if(seconds===0&&(pairing==="code"||pairing==="confirm"))setPairing("expired")},[seconds,pairing])
 function generate(){
  setCode(current=>current==="482916"?"739124":"482916")
  setSeconds(120)
  setPairing("code")
  setMessage("Example single-use pairing code generated.")
 }
 function request(){
  setState("pending")
  setMessage("Example control request received. Review it in the approval screen.")
 }
 return <section id="extension" className="section">
  <div className="section-head"><h2>Extension screens</h2><p>Compact desktop layouts built from the shared RELO components. Each preview is 360 px wide and adapts to narrower screens.</p></div>
  <p className="note">Interactive design previews with local example data. Account sign-in is deferred.</p>
  <div className="mb-6 grid max-w-sm gap-2"><Label htmlFor="extension-state">Preview receiver state</Label><Select value={state} onValueChange={value=>setState(value as ReceiverState)}><SelectTrigger id="extension-state" className="min-h-11 w-full"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(copy).map(([value,item])=><SelectItem value={value} key={value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
   <Preview title="Extension popup" description="The receiver’s main view, opened from the Chrome toolbar.">
    <Frame label="Extension popup preview">
     <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold"><Monitor className="size-4"/>My MacBook</span><Status state={state}/></div>
     <div className="space-y-2"><h3 className="m-0 text-xl font-semibold leading-7">{copy[state].title}</h3><p className="m-0 text-sm leading-6 text-muted-foreground">{copy[state].body}</p></div>
     {state==="active"&&<div className="space-y-2 rounded-lg border border-border p-4"><p className="m-0 text-xs text-muted-foreground">Designated YouTube tab</p><p className="m-0 text-sm font-medium">Late-night listening session</p><p className="m-0 text-xs text-muted-foreground">Controlled by Leon’s phone</p></div>}
     <div className="grid gap-2">
      {state==="active"?<Button className={button} variant="outline" onClick={()=>{setState("expired");setMessage("Example control session ended.")}}>End phone access</Button>:<Button className={button} disabled={state==="offline"} onClick={generate}><Link2 className="size-4"/>Pair a phone</Button>}
      {state==="pending"&&<p className="m-0 text-xs leading-5 text-muted-foreground">Use the approval preview to allow or deny this request.</p>}
      {state==="offline"&&<Button variant="outline" className={button} onClick={()=>{setState("ready");setMessage("Example receiver reconnected. A new session still needs approval.")}}>Retry connection</Button>}
     </div>
     <div className="flex items-center gap-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="size-4 shrink-0"/>Every new remote session needs desktop approval.</div>
    </Frame>
   </Preview>
   <Preview title="Pair a phone" description="Show the PIN, preview first-time confirmation, and handle expiry.">
    <Frame label="Extension pairing preview">
     <div className="flex items-center gap-2 text-sm font-semibold"><Smartphone className="size-4"/>Pair your phone</div>
     {pairing==="code"&&<><p className="m-0 text-sm leading-6 text-muted-foreground">Enter this code in RELO on your phone.</p><div className="rounded-lg border border-border px-4 py-5 text-center"><p aria-label={"Pairing PIN "+code.split("").join(" ")} className="m-0 font-sans text-[30px] font-semibold tracking-[.16em] tabular-nums">{code.slice(0,3)} {code.slice(3)}</p><p className="mb-0 mt-2 text-xs text-muted-foreground">Expires in {Math.floor(seconds/60)}∶{String(seconds%60).padStart(2,"0")}</p></div><Button variant="outline" className={button+" w-full"} onClick={()=>setPairing("confirm")}>Preview incoming phone</Button></>}
     {pairing==="confirm"&&<><div className="space-y-2"><p className="m-0 font-semibold">Pair Leon’s phone?</p><p className="m-0 text-sm leading-6 text-muted-foreground">Confirm this is the phone that requested your code.</p></div><div className="grid gap-2"><Button className={button} onClick={()=>{setPairing("paired");setPhonePaired(true);setMessage("Example phone paired. Session approval is still required.")}}>Confirm phone pairing</Button><Button variant="outline" className={button} onClick={()=>{setPairing("expired");setMessage("Example pairing rejected. This code is no longer usable.")}}>Reject pairing</Button></div></>}
     {pairing==="paired"&&<div className="space-y-2"><Badge variant="outline" className="text-[#72dfaa]">Phone paired</Badge><p className="m-0 text-sm leading-6 text-muted-foreground">This code has been used. The phone can now request a control session.</p></div>}
     {pairing==="expired"&&<div className="space-y-2"><Badge variant="outline">Code unavailable</Badge><p className="m-0 text-sm leading-6 text-muted-foreground">Generate a fresh code to pair a phone.</p></div>}
     <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Button variant="ghost" className={button} onClick={generate}>New code</Button>{(pairing==="code"||pairing==="confirm")&&<Button variant="ghost" className={button} onClick={()=>setSeconds(0)}>Preview expiry</Button>}</div>
    </Frame>
   </Preview>
   <Preview title="Receiver approval" description="Review incoming control requests inside the extension, including when notifications are suppressed.">
    <Frame label="Extension approval preview">
     <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4"/>Control request</div>
     <Status state={state}/>
     {state==="pending"?<><div className="space-y-2"><h3 className="m-0 text-xl font-semibold leading-7">Allow Leon’s phone?</h3><p className="m-0 text-sm leading-6 text-muted-foreground">This phone is requesting playback control of My MacBook for a new session.</p></div><div className="rounded-lg border border-border p-4 text-sm leading-6 text-muted-foreground">Access includes video selection, playback, volume, and the shared queue.</div><div className="grid grid-cols-2 gap-2"><Button className={button} onClick={()=>{setState("active");setMessage("Example control session approved.")}}>Approve</Button><Button variant="outline" className={button} onClick={()=>{setState("denied");setMessage("Example control request denied.")}}>Deny</Button></div><Button variant="ghost" className={button+" w-full"} onClick={()=>{setState("expired");setMessage("Example request expired without approval.")}}>Preview request expiry</Button></>:<><p className="m-0 text-sm leading-6 text-muted-foreground">{state==="active"?"This request was approved. End access from the popup at any time.":state==="denied"?"The request was declined. Playback permission was not granted.":state==="expired"?"The request or session has expired. A new approval is required.":state==="offline"?"Requests are unavailable while the receiver is offline.":"No incoming requests. Your phone can request a session after pairing."}</p><Button variant="outline" className={button+" w-full"} disabled={state==="offline"} onClick={request}>Preview new request</Button></>}
    </Frame>
   </Preview>
   <Preview title="Receiver settings & states" description="Manage notification preferences and paired phones without changing the shared design language.">
    <Frame label="Extension settings preview">
     <div className="flex items-center gap-2 text-sm font-semibold"><Settings2 className="size-4"/>Receiver settings</div>
     <div className="flex items-center justify-between gap-4"><Label htmlFor="extension-notifications" className="min-h-11 flex-1 cursor-pointer leading-5">Connection notifications</Label><Switch id="extension-notifications" checked={notifications} onCheckedChange={setNotifications}/></div>
     <p className="m-0 text-xs leading-5 text-muted-foreground">Open RELO from the toolbar to review requests when notifications are unavailable.</p>
     <div className="space-y-3 border-t border-border pt-4"><p className="m-0 text-sm font-semibold">Paired phones</p>{phonePaired?<div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm"><Smartphone className="size-4"/>Leon’s phone</span><Button variant="ghost" size="icon" className="size-11" aria-label="Revoke example phone pairing" onClick={()=>{setPhonePaired(false);setState("expired");setMessage("Example phone pairing and active access revoked.")}}><X className="size-4"/></Button></div>:<p className="m-0 text-sm leading-6 text-muted-foreground">No phones paired. Complete the pairing preview to add one.</p>}</div>
     <div className="space-y-2 border-t border-border pt-4"><div className="flex items-center gap-2 text-sm"><WifiOff className="size-4"/>Offline recovery</div><p className="m-0 text-xs leading-5 text-muted-foreground">Reopen Chrome and check the connection. A paired phone still needs a fresh approval for its next session.</p></div>
    </Frame>
   </Preview>
  </div>
  <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm text-muted-foreground">{message}</p>
 </section>
}
