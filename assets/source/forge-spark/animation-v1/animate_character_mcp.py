import bpy, math, json
from mathutils import Vector
scene=bpy.context.scene
root=bpy.data.objects['SparkRoot']
collection=bpy.data.collections['Original Forge Spark']
for obj in collection.objects:
    obj.animation_data_clear()
root.location=(0,0,0)
root.rotation_euler=(0,0,0)
root.scale=(1,1,1)
# Restore eye geometry before introducing local character controls.
for obj in collection.objects:
    if obj.name.startswith('Ivory eye'): obj.scale=(.255,.115,.29)
    if obj.name.startswith('Blink pupil'): obj.scale=(.17,.055,.215)
    if obj.name.startswith('Eye glint'): obj.scale=(.052,.018,.064)
bpy.context.view_layer.update()
def control(name, position, parent):
    obj=bpy.data.objects.new(name,None)
    collection.objects.link(obj)
    obj.empty_display_type='PLAIN_AXES'
    obj.location=position
    bpy.context.view_layer.update()
    world=obj.matrix_world.copy()
    obj.parent=parent
    obj.matrix_world=world
    bpy.context.view_layer.update()
    return obj
def reparent(obj,parent):
    world=obj.matrix_world.copy()
    obj.parent=parent
    obj.matrix_world=world
    bpy.context.view_layer.update()
torso=control('CTRL_BreatheTorso',(0,0,.55),root)
head=control('CTRL_Head',(0,0,1.35),torso)
headPrefixes=('Soft oversized head','Soft flame crest','Ivory eye','Blink pupil','Eye glint','Blush','Smile')
for obj in list(collection.objects):
    if obj.name.startswith(headPrefixes): reparent(obj,head)
for name in ('Round little body','Graphite apron','Apron spark badge'): reparent(bpy.data.objects[name],torso)
arms=[]
wings=[]
antennae=[]
for side in (-1,1):
    arm=control('CTRL_Arm_'+str(side),(side*.42,0,1.11),torso)
    for name in ('Arm '+str(side),'Hand '+str(side)): reparent(bpy.data.objects[name],arm)
    arms.append(arm)
    wing=control('CTRL_Wing_'+str(side),(side*.30,.26,1.13),torso)
    reparent(bpy.data.objects['Wing '+str(side)],wing)
    wings.append(wing)
    antenna=control('CTRL_Antenna_'+str(side),(side*.30,0,2.10),head)
    for name in ('Antenna '+str(side),'Antenna glow '+str(side)): reparent(bpy.data.objects[name],antenna)
    antennae.append(antenna)
eyes=[obj for obj in collection.objects if obj.name.startswith(('Ivory eye','Blink pupil','Eye glint'))]
controls=[torso,head]+arms+wings+antennae+eyes
base={obj.name:(obj.location.copy(),obj.rotation_euler.copy(),obj.scale.copy()) for obj in controls}
clips=[('Idle',1,48),('Blink',60,83),('Thinking',100,135),('Success',150,179),('Encouragement',200,229),('Answer',240,269)]
for name,start,end in clips:
    for frame in range(start,end+1):
        t=(frame-start)/(end-start)
        pulse=math.sin(math.pi*t)**2
        for obj in controls:
            loc,rot,scale=base[obj.name]
            obj.location=loc.copy()
            obj.rotation_euler=rot.copy()
            obj.scale=scale.copy()
        # Feet/root stay planted; torso, head and limbs move independently.
        breath=.017*math.sin(t*math.tau)
        torso.scale=(1-breath*.25,1-breath*.25,1+breath)
        torso.location.z=base[torso.name][0].z+breath*.05
        if name in ('Idle','Blink'):
            head.rotation_euler[1]=.025*math.sin(t*math.tau)
            head.rotation_euler[2]=.018*math.sin(t*math.tau)
        if name=='Thinking':
            head.rotation_euler[1]=-.14*pulse
            head.rotation_euler[2]=-.08*pulse
            arms[1].rotation_euler[0]=-.50*pulse
            arms[1].rotation_euler[1]=-.23*pulse
            for obj in eyes:
                if obj.name.startswith(('Blink pupil','Eye glint')):
                    obj.location.x=base[obj.name][0].x+.025*pulse
                    obj.location.z=base[obj.name][0].z+.028*pulse
        if name=='Success':
            head.rotation_euler[0]=-.13*math.sin(t*math.tau)*pulse
            arms[0].rotation_euler[1]=.55*pulse
            arms[1].rotation_euler[1]=-.55*pulse
            wings[0].rotation_euler[2]=-.14*pulse
            wings[1].rotation_euler[2]=.14*pulse
        if name in ('Encouragement','Answer'):
            head.rotation_euler[1]=(.11 if name=='Encouragement' else -.08)*pulse
            head.rotation_euler[0]=.07*math.sin(t*math.tau)*pulse
            arms[1].rotation_euler[0]=-.25*pulse
            arms[1].rotation_euler[1]=-.48*pulse
        for i,obj in enumerate(antennae): obj.rotation_euler[1]=.04*math.sin(t*math.tau+i*.8)*pulse
        for i,obj in enumerate(wings): obj.rotation_euler[0]=.025*math.sin(t*math.tau+i*.4)*pulse
        # Both eyes close together, with the highlight following the eyelid.
        blinkCenter=.53 if name=='Idle' else .45 if name=='Blink' else .70
        blinkWidth=.07 if name=='Idle' else .13 if name=='Blink' else .06
        close=max(0,1-abs(t-blinkCenter)/blinkWidth)
        for obj in eyes:
            obj.scale.z=base[obj.name][2].z*(1-.95*close)
            if obj.name.startswith('Eye glint'):
                obj.location.z=base[obj.name][0].z-.07*close
        for obj in controls:
            obj.keyframe_insert(data_path='location',frame=frame)
            obj.keyframe_insert(data_path='rotation_euler',frame=frame)
            obj.keyframe_insert(data_path='scale',frame=frame)
    for obj in controls:
        action=obj.animation_data.action
        action.name='Spark_'+name+'_'+obj.name
        for curve in action.fcurves:
            for key in curve.keyframe_points: key.interpolation='LINEAR'
        track=obj.animation_data.nla_tracks.new()
        track.name=name
        strip=track.strips.new(name,start,action)
        strip.action_frame_start=start
        strip.action_frame_end=end
        strip.extrapolation='NOTHING'
        obj.animation_data.action=None
    scene.timeline_markers.new(name,frame=start)
scene.frame_start=1
scene.frame_end=269
scene.render.fps=12
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=64
scene.cycles.use_denoising=False
scene.render.threads_mode='FIXED'
scene.render.threads=2
scene.render.resolution_x=160
scene.render.resolution_y=160
scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.frame_set(1)
scene.render.filepath='//spark-idle-0001.png'
bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath('//animation-v1/forge-spark-character-animated.blend'),check_existing=False)
print(json.dumps({'saved':bpy.data.filepath,'clips':clips,'controls':[obj.name for obj in controls],'render':{'size':160,'fps':12,'samples':64,'threads':2}}))
