import pytest
from measurement import metres_per_pixel,polyline_length,polygon_area,quantity

def test_calibration():
    assert metres_per_pixel((0,0),(100,0),10)==pytest.approx(0.1)
    with pytest.raises(ValueError): metres_per_pixel((0,0),(0,0),10)

def test_length():
    assert polyline_length([(0,0),(30,40),(30,50)],0.1)==pytest.approx(6)

def test_area():
    assert polygon_area([(0,0),(100,0),(100,50),(0,50)],0.1)==pytest.approx(50)

def test_volume():
    assert quantity([(0,0),(100,0),(100,50),(0,50)],0.1,'Volume (m³)',0.2)==pytest.approx((10,'m3'))

def test_invalid():
    with pytest.raises(ValueError): polygon_area([(0,0),(1,1)],1)
    with pytest.raises(ValueError): quantity([(0,0),(10,0),(10,10)],1,'Volume (m³)',0)
