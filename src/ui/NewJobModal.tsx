import { useState } from 'react';
import { useEditor } from '../editor/store';

export default function NewJobModal({ onClose }: { onClose: () => void }) {
  const createJob = useEditor((s) => s.createJob);
  const [form, setForm] = useState({ customer: '', station: '', requirements: '' });

  const submit = () => {
    if (!form.customer.trim() || !form.station.trim()) return;
    createJob(form);
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>前台接单 · 录入客户要求</h2>
        <div className="form-grid">
          <div>
            <label>客户单位 *</label>
            <input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="如：江北环境监测中心" />
          </div>
          <div>
            <label>站房名称 *</label>
            <input value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })} placeholder="如：空气站 A-07" />
          </div>
          <div className="full">
            <label>客户要求（管线走向、警示标识、分区、图例口径等）</label>
            <textarea
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              placeholder="例如：采样主管沿北墙走线，真空泵旁加高压警示标识牌，受控分区用紫色虚线……"
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={submit} disabled={!form.customer.trim() || !form.station.trim()}>
            建单（进入待派工）
          </button>
        </div>
      </div>
    </div>
  );
}
