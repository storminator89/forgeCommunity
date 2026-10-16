import bpy, math, os, json
from mathutils import Vector
OUT=os.path.dirname(os.path.abspath(__file__))
# Factory scene contains only disposable unsaved defaults; retain camera/lamp unused.
for obj in bpy.context.scene.objects: obj.hide_render=True; obj.hide_set(True)
scene=bpy.context.scene
collection=bpy.data.collections.new('Original Forge Spark'); scene.collection.children.link(collection)
def own(obj):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj); return obj
def mat(name,color,metal=0,rough=.30,emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    bs.inputs['Emission Color'].default_value=(*color,1); bs.inputs['Emission Strength'].default_value=emission
    return m
amber=mat('Warm ember',(1,.48,.13),.12); copper=mat('Copper crest',(.96,.37,.09),.35); dark=mat('Graphite',(.025,.045,.055),.1,.16); cream=mat('Warm ivory',(1,.90,.66)); mint=mat('Firefly wing',(.28,.72,.65),.15); glow=mat('Spark glow',(1,.65,.12),0,.4,1.5)
root=own(bpy.data.objects.new('SparkRoot',None)); root.empty_display_type='PLAIN_AXES'
def ico(name,loc,scale,material,sub=4,parent=root):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc); o=own(bpy.context.object); o.name=name; o.scale=scale; o.data.materials.append(material); o.parent=parent;
    for poly in o.data.polygons: poly.use_smooth=True
    return o
def rod(name,a,b,r,material,parent=root):
    d=Vector(b)-Vector(a); bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=d.length,location=(Vector(a)+Vector(b))/2); o=own(bpy.context.object); o.name=name; o.rotation_euler=d.to_track_quat('Z','Y').to_euler(); o.data.materials.append(material); o.parent=parent; return o
body=ico('Round little body',(0,.03,.93),(.43,.32,.47),amber,4)
head=ico('Soft oversized head',(0,-.02,1.63),(.72,.49,.66),amber,4)
ico('Graphite apron',(0,-.285,.87),(.25,.055,.18),dark)
ico('Apron spark badge',(0,-.345,.90),(.052,.022,.068),glow,1)
for x in [-1,1]:
    ico('Boot '+str(x),(x*.24,-.06,.48),(.20,.26,.17),amber)
    ico('Arm '+str(x),(x*.47,-.01,.97),(.13,.15,.23),amber)
    ico('Hand '+str(x),(x*.48,-.11,.82),(.16,.17,.16),amber)
    ico('Wing '+str(x),(x*.48,.33,1.17),(.36,.20,.48),mint,4).rotation_euler[1]=x*.55
    rod('Antenna '+str(x),(x*.30,0,2.10),(x*.40,0,2.42),.035,dark)
    ico('Antenna glow '+str(x),(x*.40,0,2.44),(.095,.095,.095),glow,2)
# Uneven crest establishes a distinctive forged-flame silhouette.
for x,z,h in [(-.18,2.18,.18),(.02,2.26,.24),(.19,2.18,.15)]:
    o=ico('Soft flame crest',(x,.02,z),(.12,.12,h*.70),copper,3); o.rotation_euler[1]=-.2
pupils=[]
for x in [-.24,.24]:
    pupils.append(ico('Ivory eye',(x,-.449,1.69),(.255,.115,.29),cream))
    p=ico('Blink pupil',(x+.015,-.548,1.69),(.17,.055,.215),dark); pupils.append(p)
    pupils.append(ico('Eye glint',(x-.035,-.596,1.77),(.052,.018,.064),cream,3))
ico('Blush left',(-.45,-.411,1.43),(.11,.038,.065),copper,3)
ico('Blush right',(.45,-.411,1.43),(.11,.038,.065),copper,3)
# Friendly restrained curved smile made from small geometric segments.
pts=[(-.14,-.490,1.43),(-.07,-.510,1.38),(0,-.516,1.365),(.07,-.510,1.38),(.14,-.490,1.43)]
for i in range(len(pts)-1): rod('Smile '+str(i),pts[i],pts[i+1],.019,dark)
def stash(obj,name,start,end):
    action=obj.animation_data.action; action.name=name+'_'+obj.name
    track=obj.animation_data.nla_tracks.new(); track.name=name; strip=track.strips.new(name,start,action); strip.action_frame_start=start; strip.action_frame_end=end
    obj.animation_data.action=None
for name,start,end in [('Idle',1,49),('Blink',60,84),('Celebrate',100,148)]:
    for f,v in [(start,0),(start+(end-start)//4,.06),(start+(end-start)//2,0),(start+3*(end-start)//4,-.025),(end,0)]:
        root.location.z=v if name!='Celebrate' else ([-0.045,0.36,-0.04,0.10,0][int(round((f-start)/(end-start)*4))])
        squash=1 if name!='Celebrate' else [0.94,1.08,0.94,1.02,1][int(round((f-start)/(end-start)*4))]
        root.scale=(1/math.sqrt(squash),1/math.sqrt(squash),squash); root.keyframe_insert(data_path='scale',frame=f)
        root.rotation_euler=(0,(.08*math.sin((f-start)/(end-start)*math.tau) if name=='Celebrate' else 0),0)
        root.keyframe_insert(data_path='location',frame=f); root.keyframe_insert(data_path='rotation_euler',frame=f)
    stash(root,name,start,end)
    if name=='Blink':
        for p in pupils:
            original_z=p.scale.z
            for f,s in [(start,1),(68,1),(71,.08),(74,1),(end,1)]:
                p.scale.z=original_z*s; p.keyframe_insert(data_path='scale',frame=f)
            stash(p,name,start,end)
root.location=(0,0,0); root.rotation_euler=(0,0,0)
# NLA restores each original eye scale at the end of Blink.
scene.frame_start=1; scene.frame_end=148; scene.render.fps=24; scene.frame_set(1)
for idx,x in enumerate([-.24,.24]):
    suffix='' if idx==0 else '.001'
    bpy.data.objects['Blink pupil'+suffix].location=(x+.015,-.548,1.69)
    bpy.data.objects['Eye glint'+suffix].location=(x-.035,-.596,1.77)
# Export only mascot, no studio equipment.
bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
bpy.context.view_layer.objects.active=body
original_transforms={o.name: (o.location.copy(),o.rotation_euler.copy(),o.scale.copy()) for o in collection.objects}
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'forge-spark.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_yup=True)
for o in collection.objects:
    o.location,o.rotation_euler,o.scale=original_transforms[o.name]
# Compact neutral studio still, CPU rendering only.
bpy.ops.object.camera_add(location=(2.5,-8.5,3.1)); camera=bpy.context.object; camera.name='Preview Camera'; camera.rotation_euler=(Vector((0,0,1.45))-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=3.35; scene.camera=camera
for name,loc,power,size in [('Key',(-3,-4,6),650,4),('Fill',(4,-1,3),450,3),('Rim',(0,3,5),700,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc); l=bpy.context.object; l.name=name; l.data.energy=power; l.data.shape='DISK'; l.data.size=size; l.rotation_euler=(Vector((0,0,1.2))-l.location).to_track_quat('-Z','Y').to_euler()
scene.world.color=(.20,.20,.20); scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=256; scene.cycles.use_denoising=False
scene.render.resolution_x=640; scene.render.resolution_y=640; scene.render.resolution_percentage=100; scene.render.film_transparent=True
# Keep the saved source portable: Blender resolves // beside this .blend file.
scene.render.image_settings.file_format='PNG'; scene.render.filepath='//forge-spark-preview.png'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'forge-spark.blend'))
bpy.ops.render.render(write_still=True)
for frame,label in [(71,'blink'),(112,'celebrate')]:
    scene.frame_set(frame); scene.render.filepath='//forge-spark-'+label+'.png'; bpy.ops.render.render(write_still=True)
print('ASSET_COMPLETE',OUT)
