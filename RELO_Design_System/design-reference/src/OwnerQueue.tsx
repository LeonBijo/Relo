import React from "react"
import { GripVertical, Trash2 } from "lucide-react"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"

export type QueueItem = { id:number; title:string; by:string }

function SortableItem({item,onRemove}:{item:QueueItem;onRemove:(id:number)=>void}){
 const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:item.id})
 return <li ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition,position:"relative",zIndex:isDragging?1:undefined}} className={"flex items-center gap-2 rounded-lg border p-2 "+(isDragging?"border-primary bg-secondary shadow-lg":"border-border bg-card")}>
  <Button ref={setActivatorNodeRef} variant="ghost" size="icon" className="size-11 shrink-0 touch-none cursor-grab active:cursor-grabbing" {...attributes} {...listeners} aria-label={"Reorder "+item.title} aria-describedby="queue-drag-help">
   <GripVertical className="size-5 text-muted-foreground"/>
  </Button>
  <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p><p className="text-xs leading-5 text-muted-foreground">Added by {item.by}</p></div>
  <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={"Remove "+item.title} onClick={()=>onRemove(item.id)}><Trash2 className="size-4"/></Button>
 </li>
}

export function OwnerQueue({items,onChange}:{items:QueueItem[];onChange:React.Dispatch<React.SetStateAction<QueueItem[]>>}){
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}))
 function reorder({active,over}:DragEndEvent){
  if(!over||active.id===over.id)return
  onChange(current=>{
   const from=current.findIndex(item=>item.id===active.id)
   const to=current.findIndex(item=>item.id===over.id)
   if(from<0||to<0)return current
   return arrayMove(current,from,to)
  })
 }
 return <div className="space-y-3">
  <p id="queue-drag-help" className="text-xs leading-5 text-muted-foreground">Drag the six-dot handle to reorder. With a keyboard, press Space, use the arrow keys, then press Space to drop. Escape cancels.</p>
  {items.length===0?<p className="text-sm leading-6 text-muted-foreground">Your queue is empty. Add a video to get started.</p>:
   <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder} accessibility={{screenReaderInstructions:{draggable:"Press Space to pick up a video. Use the up and down arrow keys to move it. Press Space to drop, or Escape to cancel."}}}>
    <SortableContext items={items.map(item=>item.id)} strategy={verticalListSortingStrategy}>
     <ul className="space-y-2">{items.map(item=><SortableItem key={item.id} item={item} onRemove={id=>onChange(current=>current.filter(entry=>entry.id!==id))}/>)}</ul>
    </SortableContext>
   </DndContext>}
 </div>
}
