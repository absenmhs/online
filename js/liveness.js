// Raw camera frames stay in this tab. The preview is mirrored only with CSS.
const visionRoot='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const model='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export async function loadLandmarker(){
  const {FilesetResolver,FaceLandmarker}=await import(visionRoot+'/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks(visionRoot+'/wasm');
  return FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:model},runningMode:'VIDEO',
    numFaces:2,outputFaceBlendshapes:true,minFaceDetectionConfidence:0.65,minFacePresenceConfidence:0.65,
    minTrackingConfidence:0.65});
}
export function readPose(result){
  if(result.faceLandmarks?.length!==1)return null;
  const p=result.faceLandmarks[0],scores=result.faceBlendshapes?.[0]?.categories;
  if(!p?.[263]||!scores)return null;
  const a=p[33],b=p[263],nose=p[1],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  if(len<0.003||!nose||Math.abs(dy)>Math.abs(dx)*0.6)return null;
  const yaw=((nose.x-(a.x+b.x)/2)*dx+(nose.y-(a.y+b.y)/2)*dy)/len;
  const value=name=>scores.find(c=>c.categoryName===name)?.score;
  const smile=Math.min(value('mouthSmileLeft'),value('mouthSmileRight'));
  return Number.isFinite(yaw)&&Number.isFinite(smile)?{yaw,smile}:null;
}
export const directions={TURN_LEFT:'Toleh ke kiri Anda',TURN_RIGHT:'Toleh ke kanan Anda',SMILE:'Senyum ke kamera'};
export function poseMatches(action,pose){
  if(!pose)return false;
  if(action==='neutral')return Math.abs(pose.yaw)<0.12&&pose.smile<0.36;
  if(action==='SMILE')return Math.abs(pose.yaw)<0.18&&pose.smile>=0.55;
  return action==='TURN_LEFT'?pose.yaw>0.24:action==='TURN_RIGHT'&&pose.yaw< -0.24;
}
