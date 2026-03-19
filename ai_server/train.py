from ultralytics import YOLO
import torch
import time
import os

def main():
    try:
        # ตรวจสอบการใช้งาน GPU
        device = 0 if torch.cuda.is_available() else 'cpu'
        
        # 1. Load Pre-trained Model (แนะนำ yolov8s สำหรับความสมดุล)
        model_path = "yolov8s.pt"
        if not os.path.exists(model_path):
            print(f"❌ Error: Model file '{model_path}' not found!")
            return
        
        model = YOLO(model_path)

        # 2. Start Training & จับเวลา
        print("\n" + "="*50)
        print(f"🚀 STARTING TRAINING ON DEVICE: {device}")
        print("="*50)
        
        start_time = time.time()

        # Train Model โดยใช้ Hyperparameter เดิมของคุณ + ตัวเสริมเพื่อ Accuracy
        results = model.train(
            # --- เดิมของคุณ ---
            data="dataset2/data.yaml",
            epochs=150,
            imgsz=640,
            batch=16,
            device=device,
            workers=4,
            patience=15,
            
            # --- เพิ่มเติมเพื่อให้ Robust และถึงเป้า 60% ---
            optimizer='AdamW',    # เหมาะกับงานที่มีหลาย Class (7 ยี่ห้อ)
            lr0=0.01,             # Learning Rate เริ่มต้น
            cos_lr=True,          # ปรับ LR แบบ Curve เพื่อความแม่นยำช่วงท้าย
            label_smoothing=0.1,  # ลด Overfitting
            mosaic=1.0,           # ช่วยตรวจจับ "ฝาขวด" (Small Object)
            mixup=0.1,            # ช่วยกรณีขวดวางซ้อนหรือเบียดกัน
            exist_ok=True         # ไม่สร้างโฟลเดอร์ train ซ้ำซ้อนถ้ามีอยู่แล้ว
        )
        
        end_time = time.time()
        training_duration = end_time - start_time

        # 3. Print สรุปผลการ Train (Report)
        print("\n" + "📊" + " " + "TRAINING SUMMARY REPORT")
        print("-" * 50)
        
        # ดึงค่าจาก Results Object - YOLOv8 ใช้ results.results_dict ที่เป็น dict ของ metrics
        # หรือใช้ results.save_dir เพื่อให้ได้ path ของ model ที่บันทึกไว้
        
        print(f"🔹 Configured Epochs : 150")
        print(f"🔹 Batch Size        : 16")
        print(f"🔹 Image Size        : 640")
        print(f"🔹 Learning Rate (lr0): 0.01")
        print(f"🔹 Optimizer         : AdamW")
        print(f"⏱️ Training Time     : {training_duration / 60:.2f} minutes")
        print("-" * 50)
        
        # แสดงค่า Accuracy (mAP) - ดึงจาก results object
        # YOLOv8 returns metrics ใน format dict: {'metrics/mAP50': value, ...}
        try:
            # ลองเข้าถึงผ่าน results.results_dict (dict ของ final metrics)
            if hasattr(results, 'results_dict') and results.results_dict:
                metrics = results.results_dict
                map50 = metrics.get('metrics/mAP50', metrics.get('metrics/mAP_0.5', 0))
                map50_95 = metrics.get('metrics/mAP50-95', metrics.get('metrics/mAP', 0))
            else:
                # Alternative: ดึงจาก results object directly
                map50 = getattr(results, 'map50', 0) or 0
                map50_95 = getattr(results, 'map', 0) or 0
        except Exception as e:
            print(f"⚠️ Warning: Could not retrieve metrics - {e}")
            map50 = 0
            map50_95 = 0
        
        print(f"✅ Final mAP@50      : {map50:.4f} ({map50*100:.2f}%)")
        print(f"✅ Final mAP@50-95   : {map50_95:.4f}")
        
        if map50 >= 0.60:
            print("\n🎉 Status: SUCCESS! Accuracy is above 60%")
        else:
            print("\n⚠️ Status: Accuracy below 60%. Consider increasing imgsz to 1280.")
        
        print(f"📁 Model saved to   : {results.save_dir}")
        print("="*50)
        
    except Exception as e:
        print(f"❌ Error during training: {e}")
        import traceback
        traceback.print_exc()
        return

if __name__ == "__main__":
    main()