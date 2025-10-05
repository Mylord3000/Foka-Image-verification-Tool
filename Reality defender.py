from realitydefender import RealityDefender

client = RealityDefender(api_key="rd_68b925511d181562_c7908068e2a455d17af46aced2a2563b")
result = client.detect_file("/Users/adamsienkiewicz/Documents/Kodzenie/wtc.jpg")
print(result)