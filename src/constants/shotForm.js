export const SHOT_PRESETS = {
  angle: ['仰拍', '平拍', '俯拍', '低机位', '顶视角', '鱼眼'],
  direction: ['正拍', '逆光', '顺光', '侧逆', '45°', '室内补光'],
  bestTime: [
    { value: 'day', label: '白天' },
    { value: 'golden', label: '黄金时刻' },
    { value: 'night', label: '夜景' },
  ],
};

export const EMPTY_SHOT = {
  title: '',
  spotId: '',
  spotName: '',
  district: '',
  content: '',
  angle: '',
  direction: '',
  timeWindow: '',
  bestTime: 'day',
  camera: '',
  lens: '',
  focal: '',
  aperture: '',
  shutter: '',
  iso: '',
  whiteBalance: '',
  author: '匿名拍友',
  authorBio: '',
  tags: '',
  stylesText: '',
};
